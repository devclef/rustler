use std::sync::Arc;
use sqlx::{Pool, Postgres};
use uuid::Uuid;
use tracing::{debug, info};

use crate::models::{Transaction, CreateTransactionRequest, UpdateTransactionRequest};
use crate::services::{TransactionService, RuleService};

/// Service for applying rules to transactions
pub struct TransactionRuleService {
    transaction_service: Arc<TransactionService>,
    rule_service: Arc<RuleService>,
}

impl TransactionRuleService {
    /// Get monthly incoming transactions (pass-through)
    pub async fn get_monthly_incoming_transactions(&self, year: i32, month: u32) -> Result<Vec<Transaction>, sqlx::Error> {
        self.transaction_service.get_monthly_incoming_transactions(year, month).await
    }
    /// Create a new TransactionRuleService with the given services
    pub fn new(transaction_service: Arc<TransactionService>, rule_service: Arc<RuleService>) -> Self {
        Self {
            transaction_service,
            rule_service,
        }
    }

    /// Create a transaction with rule application
    pub async fn create_transaction(&self, req: CreateTransactionRequest) -> Result<Transaction, sqlx::Error> {
        // First, create the transaction
        let transaction = self.transaction_service.create_transaction(req).await?;

        // Then apply rules to the transaction
        if let Ok(Some(update_request)) = self.rule_service.apply_rules_to_transaction(&transaction).await {
            // If any rules matched, update the transaction
            if let Ok(Some(updated_transaction)) = self.transaction_service.update_transaction(transaction.id, update_request).await {
                info!("Applied rules to transaction {}", transaction.id);
                return Ok(updated_transaction);
            }
        }

        // If no rules matched or the update failed, return the original transaction
        Ok(transaction)
    }

    /// Update a transaction with rule application
    pub async fn update_transaction(&self, id: Uuid, req: UpdateTransactionRequest) -> Result<Option<Transaction>, sqlx::Error> {
        // First, update the transaction
        let updated_transaction = self.transaction_service.update_transaction(id, req).await?;

        // If the transaction was updated successfully
        if let Some(transaction) = updated_transaction {
            // Apply rules to the transaction
            if let Ok(Some(update_request)) = self.rule_service.apply_rules_to_transaction(&transaction).await {
                // If any rules matched, update the transaction again
                if let Ok(Some(rule_updated_transaction)) = self.transaction_service.update_transaction(transaction.id, update_request).await {
                    info!("Applied rules to updated transaction {}", transaction.id);
                    return Ok(Some(rule_updated_transaction));
                }
            }

            // If no rules matched or the update failed, return the original updated transaction
            return Ok(Some(transaction));
        }

        // If the transaction wasn't found, return None
        Ok(None)
    }

    /// Delete a transaction (pass-through to TransactionService)
    pub async fn delete_transaction(&self, id: Uuid) -> Result<bool, sqlx::Error> {
        self.transaction_service.delete_transaction(id).await
    }

    /// Get a transaction by ID (pass-through to TransactionService)
    pub async fn get_transaction(&self, id: Uuid) -> Result<Option<Transaction>, sqlx::Error> {
        self.transaction_service.get_transaction(id).await
    }

    /// Get all transactions (pass-through to TransactionService)
    pub async fn get_transactions(
        &self,
        source_account_id: Option<Uuid>,
        category: Option<&str>,
        start_date: Option<chrono::DateTime<chrono::Utc>>,
        end_date: Option<chrono::DateTime<chrono::Utc>>,
        limit: Option<i64>,
        offset: Option<i64>,
    ) -> Result<Vec<Transaction>, sqlx::Error> {
        self.transaction_service.get_transactions(source_account_id, category, start_date, end_date, limit, offset).await
    }

    /// Get transactions for a specific account (pass-through to TransactionService)
    pub async fn get_account_transactions(
        &self,
        account_id: Uuid,
        limit: Option<i64>,
        offset: Option<i64>
    ) -> Result<Vec<Transaction>, sqlx::Error> {
        self.transaction_service.get_account_transactions(account_id, limit, offset).await
    }

    /// Get transactions for a specific account with search support (pass-through to TransactionService)
    pub async fn get_account_ledger_transactions(
        &self,
        account_id: Uuid,
        search: Option<&str>,
        limit: Option<i64>,
        offset: Option<i64>
    ) -> Result<Vec<Transaction>, sqlx::Error> {
        self.transaction_service.get_account_ledger_transactions(account_id, search, limit, offset).await
    }

    /// Get spending by category (pass-through to TransactionService)
    pub async fn get_spending_by_category(
        &self,
        start_date: Option<chrono::DateTime<chrono::Utc>>,
        end_date: Option<chrono::DateTime<chrono::Utc>>,
    ) -> Result<Vec<(String, f64)>, sqlx::Error> {
        self.transaction_service.get_spending_by_category(start_date, end_date).await
    }

    /// Get unbudgeted transactions (pass-through to ensure base query parity with totals)
    pub async fn get_unbudgeted_transactions(
        &self,
        start_date: Option<chrono::DateTime<chrono::Utc>>,
        end_date: Option<chrono::DateTime<chrono::Utc>>,
    ) -> Result<Vec<Transaction>, sqlx::Error> {
        self.transaction_service.get_unbudgeted_transactions(start_date, end_date).await
    }

    /// Update the cleared status of a transaction (pass-through to TransactionService)
    pub async fn update_cleared_status(&self, id: Uuid, new_status: crate::models::ClearedStatus) -> Result<Option<Transaction>, sqlx::Error> {
        self.transaction_service.update_cleared_status(id, new_status).await
    }
}
