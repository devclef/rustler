use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

/// Represents a financial account in the system
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Account {
    /// Unique identifier for the account
    pub id: Uuid,
    /// Name of the account (e.g., "Checking Account", "Savings Account")
    pub name: String,
    /// Type of account (e.g., "On Budget", "Off Budget", "External")
    pub account_type: String,
    /// Subtype of account (e.g., "Checking", "Savings", "Credit Card")
    pub account_sub_type: Option<String>,
    /// Current balance of the account
    pub balance: f64,
    /// Cleared balance of the account (balance of cleared and reconciled transactions)
    pub cleared_balance: f64,
    /// Currency of the account (e.g., "USD", "EUR")
    pub currency: String,
    /// Whether this is the default account
    pub is_default: bool,
    /// When the account was created
    pub created_at: DateTime<Utc>,
    /// When the account was last updated
    pub updated_at: DateTime<Utc>,
}

/// Data required to create a new account
#[derive(Debug, Deserialize)]
pub struct CreateAccountRequest {
    pub name: String,
    pub account_type: String,
    pub account_sub_type: Option<String>,
    pub balance: f64,
    #[serde(default)]
    pub cleared_balance: f64,
    pub currency: String,
    #[serde(default)]
    pub is_default: bool,
}

/// Data required to update an existing account
#[derive(Debug, Deserialize)]
pub struct UpdateAccountRequest {
    pub name: Option<String>,
    pub account_type: Option<String>,
    pub account_sub_type: Option<String>,
    pub balance: Option<f64>,
    pub cleared_balance: Option<f64>,
    pub currency: Option<String>,
    pub is_default: Option<bool>,
}
