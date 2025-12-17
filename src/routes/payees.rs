use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
    Router,
    routing::get,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::services::{AccountService, TransactionService};

#[derive(Debug, Deserialize)]
pub struct AutocompleteQuery {
    pub query: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct PayeeAutocompleteResponse {
    pub accounts: Vec<AccountSuggestion>,
    pub external_payees: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct AccountSuggestion {
    pub id: String,
    pub name: String,
    pub account_type: String,
}

#[derive(Debug, Serialize)]
pub struct LastCategoryResponse {
    pub category_id: Option<String>,
    pub category_name: Option<String>,
}

pub fn router(account_service: Arc<AccountService>, transaction_service: Arc<TransactionService>) -> Router {
    Router::new()
        .route("/payees/autocomplete", get(get_payee_autocomplete))
        .route("/payees/:name/last-category", get(get_payee_last_category))
        .with_state((account_service, transaction_service))
}

// Handler to get payee autocomplete suggestions
async fn get_payee_autocomplete(
    Query(query): Query<AutocompleteQuery>,
    State((account_service, transaction_service)): State<(Arc<AccountService>, Arc<TransactionService>)>,
) -> Result<Json<PayeeAutocompleteResponse>, StatusCode> {
    let search_query = query.query.unwrap_or_default();
    let search_pattern = format!("%{}%", search_query.trim());

    // Get matching accounts
    let accounts = match get_matching_accounts(&account_service, &search_pattern).await {
        Ok(accounts) => accounts,
        Err(err) => {
            eprintln!("Error getting matching accounts: {:?}", err);
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };

    // Get unique external payee names from transactions
    let external_payees = match get_matching_external_payees(&transaction_service, &search_pattern).await {
        Ok(payees) => payees,
        Err(err) => {
            eprintln!("Error getting matching external payees: {:?}", err);
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };

    Ok(Json(PayeeAutocompleteResponse {
        accounts,
        external_payees,
    }))
}

// Helper function to get matching accounts
async fn get_matching_accounts(
    account_service: &AccountService,
    search_pattern: &str,
) -> Result<Vec<AccountSuggestion>, sqlx::Error> {
    // Get all accounts first, then filter by name
    let all_accounts = account_service.get_accounts().await?;
    
    let matching_accounts = all_accounts
        .into_iter()
        .filter(|account| {
            if search_pattern == "%%" {
                // If no search query, return all accounts
                true
            } else {
                // Case-insensitive matching
                account.name.to_lowercase().contains(&search_pattern.replace('%', "").to_lowercase())
            }
        })
        .map(|account| AccountSuggestion {
            id: account.id.to_string(),
            name: account.name,
            account_type: account.account_type,
        })
        .collect();

    Ok(matching_accounts)
}

// Helper function to get matching external payees from transactions
async fn get_matching_external_payees(
    transaction_service: &TransactionService,
    search_pattern: &str,
) -> Result<Vec<String>, sqlx::Error> {
    // Call the new method we'll add to TransactionService
    transaction_service.get_external_payee_names(Some(search_pattern)).await
}

// Handler to get the last category used with a specific payee
async fn get_payee_last_category(
    Path(payee_name): Path<String>,
    State((account_service, transaction_service)): State<(Arc<AccountService>, Arc<TransactionService>)>,
) -> Result<Json<LastCategoryResponse>, StatusCode> {
    // First, check if the payee name matches an existing account
    let account_match = match get_account_by_name(&account_service, &payee_name).await {
        Ok(account) => account,
        Err(err) => {
            eprintln!("Error checking for account match: {:?}", err);
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };

    // Query for the most recent transaction with this payee
    let last_category = match get_last_category_for_payee(&transaction_service, &payee_name, account_match.as_ref()).await {
        Ok(category) => category,
        Err(err) => {
            eprintln!("Error getting last category for payee: {:?}", err);
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };

    Ok(Json(last_category))
}

// Helper function to check if payee name matches an existing account
async fn get_account_by_name(
    account_service: &AccountService,
    payee_name: &str,
) -> Result<Option<crate::models::Account>, sqlx::Error> {
    let all_accounts = account_service.get_accounts().await?;
    
    let matching_account = all_accounts
        .into_iter()
        .find(|account| account.name.eq_ignore_ascii_case(payee_name));

    Ok(matching_account)
}

// Helper function to get the last category used with a payee
async fn get_last_category_for_payee(
    transaction_service: &TransactionService,
    payee_name: &str,
    account_match: Option<&crate::models::Account>,
) -> Result<LastCategoryResponse, sqlx::Error> {
    // Call the method in TransactionService
    let (category_id, category_name) = transaction_service.get_last_category_for_payee(payee_name, account_match.map(|a| a.id)).await?;
    
    Ok(LastCategoryResponse {
        category_id: category_id.map(|id| id.to_string()),
        category_name,
    })
}