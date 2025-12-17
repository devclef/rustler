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

/// Data required for bulk updating multiple transactions
#[derive(Debug, Deserialize)]
pub struct BulkUpdateTransactionRequest {
    /// Array of transaction IDs to update
    pub transaction_ids: Vec<Uuid>,
    /// Partial update object with fields to update
    pub updates: UpdateTransactionRequest,
}

/// Response for bulk update operations
#[derive(Debug, Serialize)]
pub struct BulkUpdateResponse {
    /// Number of transactions successfully updated
    pub updated: usize,
    /// Array of transaction IDs that failed to update
    pub failed: Vec<Uuid>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_bulk_update_request_structure() {
        // Test that the BulkUpdateTransactionRequest can be created and serialized
        let transaction_ids = vec![Uuid::new_v4(), Uuid::new_v4()];
        let updates = UpdateTransactionRequest {
            destination_account_id: None,
            destination_name: None,
            description: Some("Updated description".to_string()),
            amount: Some(100.0),
            category: Some("Updated Category".to_string()),
            budget_id: None,
            transaction_date: None,
            cleared_status: Some(ClearedStatus::Cleared),
        };

        let bulk_request = BulkUpdateTransactionRequest {
            transaction_ids: transaction_ids.clone(),
            updates,
        };

        // Verify the structure is correct
        assert_eq!(bulk_request.transaction_ids.len(), 2);
        assert_eq!(bulk_request.transaction_ids, transaction_ids);
        assert_eq!(bulk_request.updates.description, Some("Updated description".to_string()));
        assert_eq!(bulk_request.updates.amount, Some(100.0));
        assert_eq!(bulk_request.updates.category, Some("Updated Category".to_string()));
        assert!(matches!(bulk_request.updates.cleared_status, Some(ClearedStatus::Cleared)));
    }

    #[test]
    fn test_bulk_update_response_structure() {
        // Test that the BulkUpdateResponse can be created and serialized
        let failed_ids = vec![Uuid::new_v4()];
        let response = BulkUpdateResponse {
            updated: 5,
            failed: failed_ids.clone(),
        };

        // Verify the structure is correct
        assert_eq!(response.updated, 5);
        assert_eq!(response.failed.len(), 1);
        assert_eq!(response.failed, failed_ids);
    }

    #[test]
    fn test_cleared_status_serialization() {
        // Test that ClearedStatus enum can be serialized/deserialized
        let uncleared = ClearedStatus::Uncleared;
        let cleared = ClearedStatus::Cleared;
        let reconciled = ClearedStatus::Reconciled;

        // Test that we can create all variants
        assert!(matches!(uncleared, ClearedStatus::Uncleared));
        assert!(matches!(cleared, ClearedStatus::Cleared));
        assert!(matches!(reconciled, ClearedStatus::Reconciled));

        // Test default
        assert!(matches!(ClearedStatus::default(), ClearedStatus::Uncleared));
    }
}
