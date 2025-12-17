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
use chrono::Utc;

use crate::models::{Transaction, CreateTransactionRequest, UpdateTransactionRequest, ClearedStatus};
use crate::services::TransactionRuleService;

pub fn router(transaction_service: Arc<TransactionRuleService>) -> Router {
    Router::new()
        .route("/transactions", get(get_transactions))
        .route("/transactions/monthly-incoming", get(get_monthly_incoming_transactions))
        .route("/transactions/unbudgeted", get(get_unbudgeted_transactions))
        .route("/transactions", post(create_transaction))
        .route("/transactions/{id}", get(get_transaction))
        .route("/transactions/{id}", put(update_transaction))
        .route("/transactions/{id}", delete(delete_transaction))
        .route("/accounts/{source_account_id}/transactions", get(get_account_transactions))
        .route("/accounts/{source_account_id}/import-csv", post(import_csv_transactions))
        .with_state(transaction_service)
}

#[derive(Debug, Deserialize)]
pub struct TransactionQuery {
    pub source_account_id: Option<Uuid>,
    pub category: Option<String>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct MonthlyIncomingQuery {
    year: i32,
    month: u32,
}

// Handler to get all transactions, with optional filtering and pagination
async fn get_transactions(
    Query(query): Query<TransactionQuery>,
    State(state): State<Arc<TransactionRuleService>>,
) -> Result<Json<Vec<Transaction>>, StatusCode> {
    // Parse dates if provided
    let start_date = query.start_date.as_ref().and_then(|date_str| {
        chrono::NaiveDate::parse_from_str(date_str, "%Y-%m-%d").ok().map(|date| {
            chrono::DateTime::<chrono::Utc>::from_utc(
                chrono::NaiveDateTime::new(
                    date,
                    chrono::NaiveTime::from_hms_opt(0, 0, 0).unwrap(),
                ),
                chrono::Utc,
            )
        })
    });

    let end_date = query.end_date.as_ref().and_then(|date_str| {
        chrono::NaiveDate::parse_from_str(date_str, "%Y-%m-%d").ok().map(|date| {
            chrono::DateTime::<chrono::Utc>::from_utc(
                chrono::NaiveDateTime::new(
                    date,
                    chrono::NaiveTime::from_hms_opt(23, 59, 59).unwrap(),
                ),
                chrono::Utc,
            )
        })
    });

    // Set default limit to 100 if not provided
    let limit = query.limit.or(Some(100));

    // Call the transaction service to get transactions with filters and pagination
    match state.get_transactions(
        query.source_account_id,
        query.category.as_deref(),
        start_date,
        end_date,
        limit,
        query.offset
    ).await {
        Ok(transactions) => Ok(Json(transactions)),
        Err(err) => {
            eprintln!("Error getting transactions: {:?}", err);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

// Handler to get monthly incoming transactions (mirrors budget_service selection)
async fn get_monthly_incoming_transactions(
    Query(params): Query<MonthlyIncomingQuery>,
    State(state): State<Arc<TransactionRuleService>>,
) -> Result<Json<Vec<Transaction>>, StatusCode> {
    match state.get_monthly_incoming_transactions(params.year, params.month).await {
        Ok(transactions) => Ok(Json(transactions)),
        Err(err) => {
            eprintln!("Error getting monthly incoming transactions: {:?}", err);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

// Handler to get unbudgeted transactions (uses the same base query as unbudgeted total)
async fn get_unbudgeted_transactions(
    Query(query): Query<TransactionQuery>,
    State(state): State<Arc<TransactionRuleService>>,
) -> Result<Json<Vec<Transaction>>, StatusCode> {
    // Parse dates if provided
    let start_date = query.start_date.as_ref().and_then(|date_str| {
        chrono::NaiveDate::parse_from_str(date_str, "%Y-%m-%d").ok().map(|date| {
            chrono::DateTime::<chrono::Utc>::from_utc(
                chrono::NaiveDateTime::new(
                    date,
                    chrono::NaiveTime::from_hms_opt(0, 0, 0).unwrap(),
                ),
                chrono::Utc,
            )
        })
    });

    let end_date = query.end_date.as_ref().and_then(|date_str| {
        chrono::NaiveDate::parse_from_str(date_str, "%Y-%m-%d").ok().map(|date| {
            chrono::DateTime::<chrono::Utc>::from_utc(
                chrono::NaiveDateTime::new(
                    date,
                    chrono::NaiveTime::from_hms_opt(23, 59, 59).unwrap(),
                ),
                chrono::Utc,
            )
        })
    });

    match state.get_unbudgeted_transactions(start_date, end_date).await {
        Ok(txs) => Ok(Json(txs)),
        Err(err) => {
            eprintln!("Error getting unbudgeted transactions: {:?}", err);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

// Handler to get transactions for a specific account
async fn get_account_transactions(
    Path(source_account_id): Path<Uuid>,
    Query(query): Query<TransactionQuery>,
    State(state): State<Arc<TransactionRuleService>>,
) -> Result<Json<Vec<Transaction>>, StatusCode> {
    // Set default limit to 100 if not provided
    let limit = query.limit.or(Some(100));

    // Call the transaction service to get transactions for the account
    match state.get_account_transactions(source_account_id, limit, query.offset).await {
        Ok(transactions) => Ok(Json(transactions)),
        Err(err) => {
            eprintln!("Error getting account transactions: {:?}", err);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

// Handler to create a new transaction
async fn create_transaction(
    State(state): State<Arc<TransactionRuleService>>,
    Json(payload): Json<CreateTransactionRequest>,
) -> Result<(StatusCode, Json<Transaction>), StatusCode> {
    // Call the transaction service to create a new transaction
    match state.create_transaction(payload).await {
        Ok(transaction) => Ok((StatusCode::CREATED, Json(transaction))),
        Err(err) => {
            eprintln!("Error creating transaction: {:?}", err);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

// Handler to get a specific transaction by ID
async fn get_transaction(
    Path(id): Path<Uuid>,
    State(state): State<Arc<TransactionRuleService>>,
) -> Result<Json<Transaction>, StatusCode> {
    // Call the transaction service to get the transaction by ID
    match state.get_transaction(id).await {
        Ok(Some(transaction)) => Ok(Json(transaction)),
        Ok(None) => Err(StatusCode::NOT_FOUND),
        Err(err) => {
            eprintln!("Error getting transaction: {:?}", err);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

// Handler to update a transaction
async fn update_transaction(
    Path(id): Path<Uuid>,
    State(state): State<Arc<TransactionRuleService>>,
    Json(payload): Json<UpdateTransactionRequest>,
) -> Result<Json<Transaction>, StatusCode> {
    // Call the transaction service to update the transaction
    match state.update_transaction(id, payload).await {
        Ok(Some(transaction)) => Ok(Json(transaction)),
        Ok(None) => Err(StatusCode::NOT_FOUND),
        Err(err) => {
            eprintln!("Error updating transaction: {:?}", err);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

// Handler to delete a transaction
async fn delete_transaction(
    Path(id): Path<Uuid>,
    State(state): State<Arc<TransactionRuleService>>,
) -> StatusCode {
    // Call the transaction service to delete the transaction
    match state.delete_transaction(id).await {
        Ok(true) => StatusCode::NO_CONTENT,
        Ok(false) => StatusCode::NOT_FOUND,
        Err(err) => {
            eprintln!("Error deleting transaction: {:?}", err);
            StatusCode::INTERNAL_SERVER_ERROR
        }
    }
}

// Structs for CSV import
#[derive(Debug, Deserialize)]
struct ColumnMapping {
    description: Option<usize>,
    amount: Option<usize>,
    category: Option<usize>,
    destination_name: Option<usize>,
    transaction_date: Option<usize>,
    budget_id: Option<usize>,
}

#[derive(Debug, Deserialize)]
struct ImportCsvRequest {
    column_mapping: ColumnMapping,
    data: Vec<Vec<String>>,
}

#[derive(Debug, Serialize)]
struct ImportCsvResponse {
    success: usize,
    failed: usize,
}

// Handler to import transactions from CSV
async fn import_csv_transactions(
    Path(source_account_id): Path<Uuid>,
    State(state): State<Arc<TransactionRuleService>>,
    Json(payload): Json<ImportCsvRequest>,
) -> Result<Json<ImportCsvResponse>, StatusCode> {
    // Validate required mappings
    if payload.column_mapping.description.is_none() || payload.column_mapping.amount.is_none() {
        return Err(StatusCode::BAD_REQUEST);
    }

    let mut success_count = 0;
    let mut failed_count = 0;

    // Process each row in the CSV data
    for row in payload.data {
        // Skip empty rows
        if row.is_empty() {
            continue;
        }

        // Extract values based on column mapping
        let description = match payload.column_mapping.description {
            Some(idx) if idx < row.len() => row[idx].clone(),
            _ => {
                failed_count += 1;
                continue;
            }
        };

        // Parse amount
        let amount_str = match payload.column_mapping.amount {
            Some(idx) if idx < row.len() => row[idx].clone(),
            _ => {
                failed_count += 1;
                continue;
            }
        };

        // Clean and parse amount
        let amount = match amount_str.trim().replace('$', "").replace(',', "").parse::<f64>() {
            Ok(val) => val,
            Err(_) => {
                failed_count += 1;
                continue;
            }
        };

        // Extract optional values
        let category = payload.column_mapping.category
            .and_then(|idx| if idx < row.len() { Some(row[idx].clone()) } else { None })
            .unwrap_or_else(|| "Uncategorized".to_string());

        let destination_name = payload.column_mapping.destination_name
            .and_then(|idx| if idx < row.len() { Some(row[idx].clone()) } else { None });

        // Parse transaction date if provided
        let transaction_date = payload.column_mapping.transaction_date
            .and_then(|idx| if idx < row.len() {
                let date_str = &row[idx];
                // Try different date formats
                // First try ISO 8601 format (e.g., 2025-08-03T17:21:12+00:00)
                if let Ok(date_time) = chrono::DateTime::parse_from_rfc3339(date_str) {
                    Some(date_time.with_timezone(&Utc))
                } else if let Ok(date) = chrono::NaiveDate::parse_from_str(date_str, "%Y-%m-%d") {
                    Some(chrono::DateTime::<Utc>::from_utc(
                        chrono::NaiveDateTime::new(date, chrono::NaiveTime::from_hms_opt(0, 0, 0).unwrap()),
                        Utc,
                    ))
                } else if let Ok(date) = chrono::NaiveDate::parse_from_str(date_str, "%m/%d/%Y") {
                    Some(chrono::DateTime::<Utc>::from_utc(
                        chrono::NaiveDateTime::new(date, chrono::NaiveTime::from_hms_opt(0, 0, 0).unwrap()),
                        Utc,
                    ))
                } else if let Ok(date) = chrono::NaiveDate::parse_from_str(date_str, "%d/%m/%Y") {
                    Some(chrono::DateTime::<Utc>::from_utc(
                        chrono::NaiveDateTime::new(date, chrono::NaiveTime::from_hms_opt(0, 0, 0).unwrap()),
                        Utc,
                    ))
                } else {
                    None
                }
            } else { None });

        // Parse budget ID if provided
        let budget_id = payload.column_mapping.budget_id
            .and_then(|idx| if idx < row.len() {
                match Uuid::parse_str(&row[idx]) {
                    Ok(id) => Some(id),
                    Err(_) => None,
                }
            } else { None });

        // Create transaction request
        let transaction_request = CreateTransactionRequest {
            source_account_id,
            destination_account_id: None,
            destination_name,
            description,
            amount,
            category,
            budget_id,
            transaction_date,
            cleared_status: ClearedStatus::Uncleared,
        };

        // Create the transaction
        match state.create_transaction(transaction_request).await {
            Ok(_) => success_count += 1,
            Err(err) => {
                eprintln!("Error creating transaction from CSV: {:?}", err);
                failed_count += 1;
            }
        }
    }

    // Return the import results
    Ok(Json(ImportCsvResponse {
        success: success_count,
        failed: failed_count,
    }))
}
