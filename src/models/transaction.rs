use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

/// Cleared status for a transaction
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "cleared_status", rename_all = "lowercase")]
pub enum ClearedStatus {
    Uncleared,
    Cleared,
    Reconciled,
}

impl Default for ClearedStatus {
    fn default() -> Self {
        ClearedStatus::Uncleared
    }
}

/// Represents a financial transaction in the system
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Transaction {
    /// Unique identifier for the transaction
    pub id: Uuid,
    /// ID of the source account for this transaction
    pub source_account_id: Uuid,
    /// ID of the destination account (required for double entry accounting)
    pub destination_account_id: Uuid,
    /// Name of the destination (used for display purposes)
    pub destination_name: Option<String>,
    /// Description of the transaction
    pub description: String,
    /// Amount of the transaction (always positive for transfers)
    pub amount: f64,
    /// Legacy category name stored on the transaction (kept for backward compatibility)
    pub category: String,
    /// Stable category ID reference; used for linking to categories so renames do not break associations
    pub category_id: Option<Uuid>,
    /// Optional budget ID this transaction is assigned to
    pub budget_id: Option<Uuid>,
    /// Date and time when the transaction occurred
    pub transaction_date: DateTime<Utc>,
    /// Cleared status of the transaction (uncleared, cleared, or reconciled)
    pub cleared_status: ClearedStatus,
    /// When the transaction record was created
    pub created_at: DateTime<Utc>,
    /// When the transaction record was last updated
    pub updated_at: DateTime<Utc>,
}

/// Data required to create a new transaction
#[derive(Debug, Deserialize, Clone)]
pub struct CreateTransactionRequest {
    /// ID of the source account for this transaction
    pub source_account_id: Uuid,
    /// ID of the destination account (optional - if not provided, will create or find an external account)
    pub destination_account_id: Option<Uuid>,
    /// Name of the destination (used when destination_account_id is not provided)
    pub destination_name: Option<String>,
    pub description: String,
    pub amount: f64,
    /// Category name to assign; the backend will resolve and store category_id
    pub category: String,
    /// Optional budget ID this transaction is assigned to
    pub budget_id: Option<Uuid>,
    pub transaction_date: Option<DateTime<Utc>>,
    /// Cleared status of the transaction (defaults to uncleared if not provided)
    #[serde(default)]
    pub cleared_status: ClearedStatus,
}

/// Data required to update an existing transaction
#[derive(Debug, Deserialize)]
pub struct UpdateTransactionRequest {
    /// ID of the destination account (optional)
    pub destination_account_id: Option<Uuid>,
    /// Name of the destination (used when destination_account_id is not provided)
    pub destination_name: Option<String>,
    pub description: Option<String>,
    pub amount: Option<f64>,
    /// Category name to assign; the backend will resolve and store category_id
    pub category: Option<String>,
    /// Optional budget ID this transaction is assigned to
    pub budget_id: Option<Uuid>,
    pub transaction_date: Option<DateTime<Utc>>,
    /// Cleared status of the transaction
    pub cleared_status: Option<ClearedStatus>,
}
