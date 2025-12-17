use sqlx::{Pool, Postgres};
use tracing::info;

/// Migrate the database to add cleared_status tracking for transactions and accounts
pub async fn add_cleared_status(pool: &Pool<Postgres>) -> Result<(), sqlx::Error> {
    info!("Running migration to add cleared_status tracking...");

    // 1. Check if the cleared_status enum type already exists
    let enum_exists = sqlx::query(
        "SELECT 1 FROM pg_type WHERE typname = 'cleared_status'"
    )
    .fetch_optional(pool)
    .await?;

    if enum_exists.is_none() {
        info!("Creating cleared_status enum type...");
        sqlx::query(
            "CREATE TYPE cleared_status AS ENUM ('uncleared', 'cleared', 'reconciled')"
        )
        .execute(pool)
        .await?;
    } else {
        info!("cleared_status enum type already exists.");
    }

    // 2. Check if the cleared_status column exists in transactions table
    let column_exists = sqlx::query(
        "SELECT column_name FROM information_schema.columns
         WHERE table_name = 'transactions' AND column_name = 'cleared_status'"
    )
    .fetch_optional(pool)
    .await?;

    if column_exists.is_none() {
        info!("Adding cleared_status column to transactions table...");
        sqlx::query(
            "ALTER TABLE transactions
             ADD COLUMN cleared_status cleared_status NOT NULL DEFAULT 'uncleared'"
        )
        .execute(pool)
        .await?;

        // Create index on cleared_status for faster filtering
        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_transactions_cleared_status 
             ON transactions(cleared_status)"
        )
        .execute(pool)
        .await?;
    } else {
        info!("cleared_status column already exists in transactions table.");
    }

    // 3. Check if the cleared_balance column exists in accounts table
    let cleared_balance_exists = sqlx::query(
        "SELECT column_name FROM information_schema.columns
         WHERE table_name = 'accounts' AND column_name = 'cleared_balance'"
    )
    .fetch_optional(pool)
    .await?;

    if cleared_balance_exists.is_none() {
        info!("Adding cleared_balance column to accounts table...");
        sqlx::query(
            "ALTER TABLE accounts
             ADD COLUMN cleared_balance FLOAT8 NOT NULL DEFAULT 0.0"
        )
        .execute(pool)
        .await?;

        // Calculate initial cleared_balance for all accounts based on cleared/reconciled transactions
        info!("Calculating initial cleared_balance for all accounts...");
        
        // Update source accounts (subtract cleared/reconciled transaction amounts)
        sqlx::query(
            "UPDATE accounts a
             SET cleared_balance = a.balance - COALESCE(
                 (SELECT SUM(t.amount)
                  FROM transactions t
                  WHERE t.source_account_id = a.id
                  AND t.cleared_status = 'uncleared'),
                 0
             )"
        )
        .execute(pool)
        .await?;
    } else {
        info!("cleared_balance column already exists in accounts table.");
    }

    info!("Cleared status migration completed successfully!");
    Ok(())
}
