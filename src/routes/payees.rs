use axum::{
    extract::{Query, State},
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

pub fn router(account_service: Arc<AccountService>, transaction_service: Arc<TransactionService>) -> Router {
    Router::new()
        .route("/payees/autocomplete", get(get_payee_autocomplete))
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