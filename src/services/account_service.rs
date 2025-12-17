use sqlx::{Pool, Postgres};
use uuid::Uuid;

use crate::models::{Account, CreateAccountRequest, UpdateAccountRequest, ClearedStatus};

/// Service for handling account-related operations
pub struct AccountService {
    db: Pool<Postgres>,
}

impl AccountService {
    /// Create a new AccountService with the given database pool
    pub fn new(db: Pool<Postgres>) -> Self {
        Self { db }
    }

    /// Get all accounts, with default account first
    pub async fn get_accounts(&self) -> Result<Vec<Account>, sqlx::Error> {
        sqlx::query_as::<_, Account>("SELECT * FROM accounts ORDER BY is_default DESC, name")
            .fetch_all(&self.db)
            .await
    }

    /// Get an account by ID
    pub async fn get_account(&self, id: Uuid) -> Result<Option<Account>, sqlx::Error> {
        sqlx::query_as::<_, Account>("SELECT * FROM accounts WHERE id = $1")
            .bind(id)
            .fetch_optional(&self.db)
            .await
    }

    /// Create a new account
    pub async fn create_account(&self, req: CreateAccountRequest) -> Result<Account, sqlx::Error> {
        let now = chrono::Utc::now();
        let account_id = Uuid::new_v4();

        // Start a transaction to ensure atomicity
        let mut tx = self.db.begin().await?;

        // If this account should be default, unset others first to satisfy unique partial index
        if req.is_default {
            sqlx::query("UPDATE accounts SET is_default = false WHERE is_default = true")
                .execute(&mut *tx)
                .await?;
        }

        // Create the account including is_default
        let account = sqlx::query_as::<_, Account>(
            r#"
            INSERT INTO accounts (id, name, account_type, account_sub_type, balance, cleared_balance, currency, is_default, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING *
            "#,
        )
        .bind(account_id)
        .bind(&req.name)
        .bind(&req.account_type)
        .bind(&req.account_sub_type)
        .bind(req.balance)
        .bind(req.cleared_balance)
        .bind(&req.currency)
        .bind(req.is_default)
        .bind(now)
        .bind(now)
        .fetch_one(&mut *tx)
        .await?;

        // If the initial balance is not zero, create an 'Initial Balance' transaction
        if req.balance != 0.0 {
            // Create an external account for the initial balance source/destination
            let external_account_id = Uuid::new_v4();
            sqlx::query(
                r#"
                INSERT INTO accounts (id, name, account_type, account_sub_type, balance, cleared_balance, currency, created_at, updated_at)
                VALUES ($1, $2, 'External', NULL, $3, $4, $5, $6, $7)
                "#,
            )
            .bind(external_account_id)
            .bind("Initial Balance")
            .bind(0.0)
            .bind(0.0)
            .bind(&req.currency)
            .bind(now)
            .bind(now)
            .execute(&mut *tx)
            .await?;

            // Determine if this is an initial deposit (positive balance) or initial debt (negative balance)
            let (source_id, destination_id, amount) = if req.balance > 0.0 {
                // For positive balance, money comes from external account to the new account
                (external_account_id, account_id, req.balance)
            } else {
                // For negative balance, money goes from the new account to external account
                (account_id, external_account_id, req.balance.abs())
            };

            // Create the transaction
            sqlx::query(
                r#"
                INSERT INTO transactions (id, account_id, source_account_id, destination_account_id, destination_name, description, amount, category, transaction_date, cleared_status, created_at, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                "#,
            )
            .bind(Uuid::new_v4())
            .bind(account_id)
            .bind(source_id)
            .bind(destination_id)
            .bind("Initial Balance")
            .bind("Initial Balance")
            .bind(amount)
            .bind("Initial Balance")
            .bind(now)
            .bind(ClearedStatus::Uncleared)
            .bind(now)
            .bind(now)
            .execute(&mut *tx)
            .await?;
        }

        // Commit the transaction
        tx.commit().await?;

        Ok(account)
    }

    /// Update an existing account
    pub async fn update_account(&self, id: Uuid, req: UpdateAccountRequest) -> Result<Option<Account>, sqlx::Error> {
        // First, check if the account exists
        let account = self.get_account(id).await?;

        if account.is_none() {
            return Ok(None);
        }

        let now = chrono::Utc::now();

        // Start a transaction to ensure atomicity, especially when toggling default
        let mut tx = self.db.begin().await?;

        // If setting this account as default, unset others first to satisfy unique partial index
        if let Some(true) = req.is_default {
            sqlx::query("UPDATE accounts SET is_default = false WHERE is_default = true")
                .execute(&mut *tx)
                .await?;
        }

        // Build the update query dynamically based on which fields are provided
        let mut query = String::from("UPDATE accounts SET updated_at = $1");
        let mut params: Vec<String> = vec![];

        if let Some(name) = &req.name {
            params.push(format!("name = '{}'", name));
        }

        if let Some(account_type) = &req.account_type {
            params.push(format!("account_type = '{}'", account_type));
        }

        if let Some(account_sub_type) = &req.account_sub_type {
            params.push(format!("account_sub_type = '{}'", account_sub_type));
        }

        if let Some(balance) = req.balance {
            params.push(format!("balance = {}", balance));
        }

        if let Some(cleared_balance) = req.cleared_balance {
            params.push(format!("cleared_balance = {}", cleared_balance));
        }

        if let Some(currency) = &req.currency {
            params.push(format!("currency = '{}'", currency));
        }

        if let Some(is_default) = req.is_default {
            params.push(format!("is_default = {}", if is_default { "true" } else { "false" }));
        }

        if !params.is_empty() {
            query.push_str(", ");
            query.push_str(&params.join(", "));
        }

        query.push_str(" WHERE id = $2 RETURNING *");

        let updated = sqlx::query_as::<_, Account>(&query)
            .bind(now)
            .bind(id)
            .fetch_optional(&mut *tx)
            .await?;

        tx.commit().await?;

        Ok(updated)
    }

    /// Delete an account
    pub async fn delete_account(&self, id: Uuid) -> Result<bool, sqlx::Error> {
        // First, check if the account exists
        let account = self.get_account(id).await?;

        if account.is_none() {
            println!("Account with id {} not found, cannot delete", id);
            return Ok(false);
        }

        println!("Attempting to delete account with id: {}", id);

        // Check if there are any transactions where this account is used as source or destination
        let source_transactions_count = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM transactions WHERE source_account_id = $1"
        )
        .bind(id)
        .fetch_one(&self.db)
        .await?;

        let destination_transactions_count = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM transactions WHERE destination_account_id = $1"
        )
        .bind(id)
        .fetch_one(&self.db)
        .await?;

        let total_transactions = source_transactions_count + destination_transactions_count;
        println!("Found {} transactions for account {} ({} as source, {} as destination)",
                 total_transactions, id, source_transactions_count, destination_transactions_count);

        if total_transactions > 0 {
            println!("Cannot delete account with existing transactions");
            return Ok(false);
        }

        // Use a transaction to ensure atomicity
        let mut tx = self.db.begin().await?;

        // Delete the account
        let result = sqlx::query("DELETE FROM accounts WHERE id = $1")
            .bind(id)
            .execute(&mut *tx)
            .await?;

        let rows_affected = result.rows_affected();
        println!("Delete query affected {} rows for account {}", rows_affected, id);

        // Commit the transaction
        println!("Committing transaction...");
        tx.commit().await?;
        println!("Transaction committed successfully");

        Ok(rows_affected > 0)
    }
}
