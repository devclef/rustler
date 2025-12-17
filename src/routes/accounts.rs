use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
    Router,
    routing::{get, post, put, delete},
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use std::sync::Arc;

use crate::models::{Account, CreateAccountRequest, UpdateAccountRequest, Transaction, ClearedStatus};
use crate::services::{AccountService, TransactionService};

#[derive(Debug, Deserialize)]
pub struct LedgerQuery {
    pub page: Option<i64>,
    pub limit: Option<i64>,
    pub search: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct LedgerTransaction {
    pub id: Uuid,
    pub date: chrono::DateTime<chrono::Utc>,
    pub payee: String,
    pub category: String,
    pub cleared_status: ClearedStatus,
    pub outflow: Option<f64>,
    pub inflow: Option<f64>,
    pub memo: String,
    pub is_transfer: bool,
}

#[derive(Debug, Serialize)]
pub struct LedgerResponse {
    pub transactions: Vec<LedgerTransaction>,
    pub total_count: i64,
    pub current_balance: f64,
    pub cleared_balance: f64,
}

pub fn router(account_service: Arc<AccountService>, transaction_service: Arc<TransactionService>) -> Router {
    Router::new()
        .route("/accounts", get(get_accounts))
        .route("/accounts", post(create_account))
        .route("/accounts/{id}", get(get_account))
        .route("/accounts/{id}", put(update_account))
        .route("/accounts/{id}", post(update_account))  // Add POST handler for account updates
        .route("/accounts/{id}", delete(delete_account))
        .route("/accounts/{id}/ledger", get(get_account_ledger))
        .with_state((account_service, transaction_service))
}

// Handler to get all accounts
async fn get_accounts(
    State((account_service, _)): State<(Arc<AccountService>, Arc<TransactionService>)>,
) -> Result<Json<Vec<Account>>, StatusCode> {
    // Call the account service to get all accounts
    match account_service.get_accounts().await {
        Ok(accounts) => Ok(Json(accounts)),
        Err(err) => {
            eprintln!("Error getting accounts: {:?}", err);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

// Handler to create a new account
async fn create_account(
    State((account_service, _)): State<(Arc<AccountService>, Arc<TransactionService>)>,
    Json(payload): Json<CreateAccountRequest>,
) -> Result<(StatusCode, Json<Account>), StatusCode> {
    // Call the account service to create a new account
    match account_service.create_account(payload).await {
        Ok(account) => Ok((StatusCode::CREATED, Json(account))),
        Err(err) => {
            eprintln!("Error creating account: {:?}", err);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

// Handler to get a specific account by ID
async fn get_account(
    Path(id): Path<Uuid>,
    State((account_service, _)): State<(Arc<AccountService>, Arc<TransactionService>)>,
) -> Result<Json<Account>, StatusCode> {
    // Call the account service to get the account by ID
    match account_service.get_account(id).await {
        Ok(Some(account)) => Ok(Json(account)),
        Ok(None) => Err(StatusCode::NOT_FOUND),
        Err(err) => {
            eprintln!("Error getting account: {:?}", err);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

// Handler to update an account
async fn update_account(
    Path(id): Path<Uuid>,
    State((account_service, _)): State<(Arc<AccountService>, Arc<TransactionService>)>,
    Json(payload): Json<UpdateAccountRequest>,
) -> Result<Json<Account>, StatusCode> {
    // Call the account service to update the account
    match account_service.update_account(id, payload).await {
        Ok(Some(account)) => Ok(Json(account)),
        Ok(None) => Err(StatusCode::NOT_FOUND),
        Err(err) => {
            eprintln!("Error updating account: {:?}", err);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

// Handler to delete an account
async fn delete_account(
    Path(id): Path<Uuid>,
    State((account_service, _)): State<(Arc<AccountService>, Arc<TransactionService>)>,
) -> StatusCode {
    // Call the account service to delete the account
    match account_service.delete_account(id).await {
        Ok(true) => StatusCode::NO_CONTENT,
        Ok(false) => StatusCode::NOT_FOUND,
        Err(err) => {
            eprintln!("Error deleting account: {:?}", err);
            StatusCode::INTERNAL_SERVER_ERROR
        }
    }
}

// Handler to get account ledger with pagination and search
async fn get_account_ledger(
    Path(account_id): Path<Uuid>,
    Query(query): Query<LedgerQuery>,
    State((account_service, transaction_service)): State<(Arc<AccountService>, Arc<TransactionService>)>,
) -> Result<Json<LedgerResponse>, StatusCode> {
    // First, verify the account exists and get its details
    let account = match account_service.get_account(account_id).await {
        Ok(Some(account)) => account,
        Ok(None) => return Err(StatusCode::NOT_FOUND),
        Err(err) => {
            eprintln!("Error getting account: {:?}", err);
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };

    // Set default pagination values
    let page = query.page.unwrap_or(1).max(1);
    let limit = query.limit.unwrap_or(50).min(1000); // Cap at 1000 for performance
    let offset = (page - 1) * limit;

    // Get transactions for this account with pagination and search
    let transactions = match transaction_service.get_account_ledger_transactions(
        account_id, 
        query.search.as_deref(), 
        Some(limit), 
        Some(offset)
    ).await {
        Ok(transactions) => transactions,
        Err(err) => {
            eprintln!("Error getting account transactions: {:?}", err);
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };

    // Get total count for pagination (simplified - in production you'd want a separate count query)
    let total_count = transactions.len() as i64;

    // Transform transactions to ledger format with perspective transformation
    let ledger_transactions = transform_transactions_for_ledger(account_id, transactions, &account_service).await?;

    Ok(Json(LedgerResponse {
        transactions: ledger_transactions,
        total_count,
        current_balance: account.balance,
        cleared_balance: account.cleared_balance,
    }))
}

// Helper function to transform transactions for ledger view (Task 4.2)
async fn transform_transactions_for_ledger(
    account_id: Uuid,
    transactions: Vec<Transaction>,
    account_service: &AccountService,
) -> Result<Vec<LedgerTransaction>, StatusCode> {
    let mut ledger_transactions = Vec::new();

    for transaction in transactions {
        // Determine if this is a transfer (both accounts are tracked)
        let is_transfer = is_transfer_transaction(&transaction, account_service).await?;

        // Compute payee field based on account perspective
        let payee = compute_payee_for_account(&transaction, account_id, account_service).await?;

        // Compute inflow/outflow based on transaction direction
        let (inflow, outflow) = compute_inflow_outflow(&transaction, account_id);

        // Get category name (prefer category_id lookup, fall back to legacy category field)
        let category = transaction.category.clone(); // For now, use the legacy field

        ledger_transactions.push(LedgerTransaction {
            id: transaction.id,
            date: transaction.transaction_date,
            payee,
            category,
            cleared_status: transaction.cleared_status,
            outflow,
            inflow,
            memo: transaction.description,
            is_transfer,
        });
    }

    Ok(ledger_transactions)
}

// Helper function to determine if a transaction is a transfer
async fn is_transfer_transaction(
    transaction: &Transaction,
    account_service: &AccountService,
) -> Result<bool, StatusCode> {
    // Get both source and destination accounts
    let source_account = match account_service.get_account(transaction.source_account_id).await {
        Ok(Some(account)) => account,
        Ok(None) => return Ok(false), // If source account doesn't exist, not a transfer
        Err(err) => {
            eprintln!("Error getting source account: {:?}", err);
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };

    let destination_account = match account_service.get_account(transaction.destination_account_id).await {
        Ok(Some(account)) => account,
        Ok(None) => return Ok(false), // If destination account doesn't exist, not a transfer
        Err(err) => {
            eprintln!("Error getting destination account: {:?}", err);
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };

    // A transfer is between two tracked accounts (On Budget or Off Budget)
    let is_source_tracked = matches!(source_account.account_type.as_str(), "On Budget" | "Off Budget");
    let is_destination_tracked = matches!(destination_account.account_type.as_str(), "On Budget" | "Off Budget");

    Ok(is_source_tracked && is_destination_tracked)
}

// Helper function to compute payee field based on account perspective
async fn compute_payee_for_account(
    transaction: &Transaction,
    account_id: Uuid,
    account_service: &AccountService,
) -> Result<String, StatusCode> {
    if transaction.source_account_id == account_id {
        // Current account is source, show destination as payee
        if let Some(dest_name) = &transaction.destination_name {
            Ok(dest_name.clone())
        } else {
            // Look up destination account name
            match account_service.get_account(transaction.destination_account_id).await {
                Ok(Some(account)) => Ok(account.name),
                Ok(None) => Ok("Unknown".to_string()),
                Err(err) => {
                    eprintln!("Error getting destination account: {:?}", err);
                    Err(StatusCode::INTERNAL_SERVER_ERROR)
                }
            }
        }
    } else {
        // Current account is destination, show source as payee
        match account_service.get_account(transaction.source_account_id).await {
            Ok(Some(account)) => Ok(account.name),
            Ok(None) => Ok("Unknown".to_string()),
            Err(err) => {
                eprintln!("Error getting source account: {:?}", err);
                Err(StatusCode::INTERNAL_SERVER_ERROR)
            }
        }
    }
}

// Helper function to compute inflow/outflow based on transaction direction
fn compute_inflow_outflow(transaction: &Transaction, account_id: Uuid) -> (Option<f64>, Option<f64>) {
    if transaction.source_account_id == account_id {
        // Money leaving the account (outflow)
        (None, Some(transaction.amount))
    } else {
        // Money entering the account (inflow)
        (Some(transaction.amount), None)
    }
}
