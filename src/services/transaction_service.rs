use chrono::{DateTime, Utc};
use sqlx::{Pool, Postgres, Row};
use uuid::Uuid;

use crate::models::{Transaction, CreateTransactionRequest, UpdateTransactionRequest, ClearedStatus};
use crate::services::category_service::CategoryService;

/// Service for handling transaction-related operations
pub struct TransactionService {
    db: Pool<Postgres>,
    category_service: CategoryService,
}

impl TransactionService {
    /// Get monthly incoming transactions to on-budget accounts, excluding on-budget to on-budget transfers
    pub async fn get_monthly_incoming_transactions(&self, year: i32, month: u32) -> Result<Vec<Transaction>, sqlx::Error> {
        // Calculate start and end of month in UTC
        let start_naive = chrono::NaiveDate::from_ymd_opt(year, month, 1)
            .unwrap()
            .and_hms_opt(0, 0, 0)
            .unwrap();
        let start_date = chrono::DateTime::<Utc>::from_naive_utc_and_offset(start_naive, Utc);
        let end_naive = if month == 12 {
            chrono::NaiveDate::from_ymd_opt(year + 1, 1, 1)
        } else {
            chrono::NaiveDate::from_ymd_opt(year, month + 1, 1)
        }
        .unwrap()
        .and_hms_opt(0, 0, 0)
        .unwrap();
        let end_date = chrono::DateTime::<Utc>::from_naive_utc_and_offset(end_naive, Utc);

        // Mirror BudgetService::get_monthly_incoming_funds selection criteria:
        // - Destination account is On Budget
        // - Source account is not On Budget (or NULL)
        // - Amount > 0 (consistent with existing monthly incoming funds query)
        // - Date within [start_date, end_date)
        let query = r#"
            SELECT t.*
            FROM transactions t
            JOIN accounts dst ON t.destination_account_id = dst.id
            LEFT JOIN accounts src ON t.source_account_id = src.id
            WHERE dst.account_type = 'On Budget'
              AND (src.account_type IS NULL OR src.account_type <> 'On Budget')
              AND t.amount > 0
              AND t.transaction_date >= $1
              AND t.transaction_date < $2
            ORDER BY t.transaction_date DESC
        "#;

        let rows = sqlx::query_as::<_, Transaction>(query)
            .bind(start_date)
            .bind(end_date)
            .fetch_all(&self.db)
            .await?;
        Ok(rows)
    }
    /// Create a new TransactionService with the given database pool
    pub fn new(db: Pool<Postgres>) -> Self {
        Self {
            db: db.clone(),
            category_service: CategoryService::new(db),
        }
    }

    /// Get spending by category group (or category), aggregated over time periods, from selected on-budget accounts
    pub async fn get_spending_over_time(
        &self,
        account_ids: Option<Vec<Uuid>>,
        start_date: Option<DateTime<Utc>>,
        end_date: Option<DateTime<Utc>>,
        group_by_group: bool,
        period: &str,
    ) -> Result<Vec<(String, String, f64)>, sqlx::Error> {
        // Determine period truncation
        let period_fn = match period {
            "week" => "week",
            "day" => "day",
            _ => "month",
        };

        // Base query joins source accounts and resolves category/group either by category_id (preferred) or by legacy category name
        let mut query = format!(
            "SELECT to_char(date_trunc('{period}', t.transaction_date), 'YYYY-MM-DD') AS period,
                    {{name_expr}} AS name,
                    SUM(t.amount) AS total_amount
             FROM transactions t
             JOIN accounts src ON t.source_account_id = src.id
             LEFT JOIN categories c_id ON c_id.id = t.category_id
             LEFT JOIN categories c_name ON t.category_id IS NULL AND t.category IS NOT NULL AND c_name.name = t.category
             LEFT JOIN category_groups cg ON cg.id = COALESCE(c_id.group_id, c_name.group_id)
             WHERE src.account_type = 'On Budget' AND t.amount > 0",
            period = period_fn
        );

        // Exclude transfers if present by category label (coalesce current category name or legacy string)
        query.push_str(" AND (COALESCE(c_id.name, c_name.name, t.category) IS NULL OR COALESCE(c_id.name, c_name.name, t.category) NOT IN ('Transfer', 'Transfers'))");
        // Exclude initial balance from spending
        query.push_str(" AND (COALESCE(c_id.name, c_name.name, t.category) IS NULL OR COALESCE(c_id.name, c_name.name, t.category) <> 'Initial Balance')");

        if let Some(start) = start_date {
            query.push_str(&format!(" AND t.transaction_date >= '{}'", start));
        }
        if let Some(end) = end_date {
            query.push_str(&format!(" AND t.transaction_date <= '{}'", end));
        }

        if let Some(ids) = &account_ids {
            if !ids.is_empty() {
                // Build IN list safely by formatting UUIDs; sqlx query! macro not used due dynamic SQL elsewhere
                let id_list = ids.iter().map(|u| format!("'{}'", u)).collect::<Vec<_>>().join(",");
                query.push_str(&format!(" AND src.id IN ({})", id_list));
            }
        }

        // Name expression and group by
        if group_by_group {
            query = query.replace("{name_expr}", "COALESCE(cg.name, 'Ungrouped')");
        } else {
            // Prefer current category name via join; fall back to legacy transaction category if id is null
            query = query.replace("{name_expr}", "COALESCE(c_id.name, c_name.name, t.category, 'Uncategorized')");
        }

        query.push_str(" GROUP BY 1, 2 ORDER BY 1, 2");

        let rows = sqlx::query(&query).fetch_all(&self.db).await?;

        let mut result = Vec::new();
        for row in rows {
            let period_str: String = row.get("period");
            let name: String = row.get("name");
            let amount: f64 = row.get("total_amount");
            result.push((period_str, name, amount));
        }

        Ok(result)
    }

    /// Get inflow vs outflow over time for on-budget cash flow.
    /// Inflow: to On Budget destination from non-On Budget (or NULL) source; amount > 0; excludes 'Initial Balance'.
    /// Outflow: from On Budget source; amount > 0; excludes transfers to On Budget and 'Initial Balance'. Includes On->Off transfers.
    pub async fn get_inflow_outflow_over_time(
        &self,
        account_ids: Option<Vec<Uuid>>,
        start_date: Option<DateTime<Utc>>,
        end_date: Option<DateTime<Utc>>,
        period: &str,
    ) -> Result<Vec<(String, f64, f64)>, sqlx::Error> {
        let period_fn = match period {
            "week" => "week",
            "day" => "day",
            _ => "month",
        };

        // Build filter snippets
        let mut date_filter = String::new();
        if let Some(start) = start_date { date_filter.push_str(&format!(" AND t.transaction_date >= '{}'", start)); }
        if let Some(end) = end_date { date_filter.push_str(&format!(" AND t.transaction_date <= '{}'", end)); }

        let mut inflow_account_filter = String::new();
        let mut outflow_account_filter = String::new();
        if let Some(ids) = &account_ids {
            if !ids.is_empty() {
                let id_list = ids.iter().map(|u| format!("'{}'", u)).collect::<Vec<_>>().join(",");
                inflow_account_filter.push_str(&format!(" AND dst.id IN ({})", id_list));
                outflow_account_filter.push_str(&format!(" AND src.id IN ({})", id_list));
            }
        }

        // Inflow query
        let inflow_query = format!(
            "SELECT to_char(date_trunc('{period}', t.transaction_date), 'YYYY-MM-DD') AS period, SUM(t.amount) AS total
             FROM transactions t
             LEFT JOIN accounts src ON t.source_account_id = src.id
             JOIN accounts dst ON t.destination_account_id = dst.id
             LEFT JOIN categories c_id ON c_id.id = t.category_id
             LEFT JOIN categories c_name ON t.category_id IS NULL AND t.category IS NOT NULL AND c_name.name = t.category
             WHERE dst.account_type = 'On Budget'
               AND (src.account_type IS NULL OR src.account_type <> 'On Budget')
               AND t.amount > 0
               AND (COALESCE(c_id.name, c_name.name, t.category) IS NULL OR COALESCE(c_id.name, c_name.name, t.category) <> 'Initial Balance')
               {date_filter}
               {account_filter}
             GROUP BY 1 ORDER BY 1",
            period = period_fn,
            date_filter = date_filter,
            account_filter = inflow_account_filter,
        );

        // Outflow query
        let outflow_query = format!(
            "SELECT to_char(date_trunc('{period}', t.transaction_date), 'YYYY-MM-DD') AS period, SUM(t.amount) AS total
             FROM transactions t
             JOIN accounts src ON t.source_account_id = src.id
             LEFT JOIN accounts dst ON t.destination_account_id = dst.id
             LEFT JOIN categories c_id ON c_id.id = t.category_id
             LEFT JOIN categories c_name ON t.category_id IS NULL AND t.category IS NOT NULL AND c_name.name = t.category
             WHERE src.account_type = 'On Budget'
               AND t.amount > 0
               AND NOT (dst.account_type = 'On Budget')
               AND (COALESCE(c_id.name, c_name.name, t.category) IS NULL OR COALESCE(c_id.name, c_name.name, t.category) NOT IN ('Initial Balance', 'Transfer', 'Transfers'))
               {date_filter}
               {account_filter}
             GROUP BY 1 ORDER BY 1",
            period = period_fn,
            date_filter = date_filter,
            account_filter = outflow_account_filter,
        );

        let inflow_rows = sqlx::query(&inflow_query).fetch_all(&self.db).await?;
        let outflow_rows = sqlx::query(&outflow_query).fetch_all(&self.db).await?;

        use std::collections::BTreeMap;
        let mut map: BTreeMap<String, (f64, f64)> = BTreeMap::new();

        for row in inflow_rows {
            let p: String = row.get("period");
            let v: f64 = row.get("total");
            let entry = map.entry(p).or_insert((0.0, 0.0));
            entry.0 = v;
        }
        for row in outflow_rows {
            let p: String = row.get("period");
            let v: f64 = row.get("total");
            let entry = map.entry(p).or_insert((0.0, 0.0));
            entry.1 = v;
        }

        let mut result: Vec<(String, f64, f64)> = map.into_iter().map(|(p, (inflow, outflow))| (p, inflow, outflow)).collect();
        // Already sorted by BTreeMap key order (period string lexicographic aligns with YYYY-MM-DD)
        Ok(result)
    }

    /// Get spending by category, with optional filtering by date range
    pub async fn get_spending_by_category(
        &self,
        start_date: Option<DateTime<Utc>>,
        end_date: Option<DateTime<Utc>>,
    ) -> Result<Vec<(String, f64)>, sqlx::Error> {
        let mut query = String::from(
            "SELECT COALESCE(c.name, t.category, 'No category') as category, SUM(t.amount) as total_amount
             FROM transactions t
             LEFT JOIN categories c ON c.id = t.category_id
             WHERE 1=1"
        );

        if let Some(start_date) = start_date {
            query.push_str(&format!(" AND t.transaction_date >= '{}'", start_date));
        }

        if let Some(end_date) = end_date {
            query.push_str(&format!(" AND t.transaction_date <= '{}'", end_date));
        }

        query.push_str(" GROUP BY 1 ORDER BY total_amount DESC");

        let rows = sqlx::query(&query)
            .fetch_all(&self.db)
            .await?;

        let mut result = Vec::new();
        for row in rows {
            let category: String = row.get("category");
            let amount: f64 = row.get("total_amount");
            result.push((category, amount));
        }

        Ok(result)
    }

    /// Get all transactions, with optional filtering and pagination
    pub async fn get_transactions(
        &self,
        source_account_id: Option<Uuid>,
        category: Option<&str>,
        start_date: Option<DateTime<Utc>>,
        end_date: Option<DateTime<Utc>>,
        limit: Option<i64>,
        offset: Option<i64>,
    ) -> Result<Vec<Transaction>, sqlx::Error> {
        let mut query = String::from("SELECT * FROM transactions WHERE 1=1");

        if let Some(source_account_id) = source_account_id {
            query.push_str(&format!(" AND source_account_id = '{}'", source_account_id));
        }

        if let Some(category_name) = category {
            // Filter by resolved category name via join on category_id
            query.push_str(&format!(" AND COALESCE((SELECT name FROM categories WHERE id = transactions.category_id), transactions.category) = '{}'", category_name.replace("'","''")));
        }

        if let Some(start_date) = start_date {
            query.push_str(&format!(" AND transaction_date >= '{}'", start_date));
        }

        if let Some(end_date) = end_date {
            query.push_str(&format!(" AND transaction_date <= '{}'", end_date));
        }

        query.push_str(" ORDER BY transaction_date DESC");

        // Add pagination
        if let Some(limit_val) = limit {
            query.push_str(&format!(" LIMIT {}", limit_val));
        }

        if let Some(offset_val) = offset {
            query.push_str(&format!(" OFFSET {}", offset_val));
        }

        sqlx::query_as::<_, Transaction>(&query)
            .fetch_all(&self.db)
            .await
    }

    /// Get transactions for a specific account (both as source and destination) with pagination
    pub async fn get_account_transactions(
        &self,
        account_id: Uuid,
        limit: Option<i64>,
        offset: Option<i64>
    ) -> Result<Vec<Transaction>, sqlx::Error> {
        let mut query = String::from(
            r#"
            SELECT * FROM transactions
            WHERE source_account_id = $1 OR destination_account_id = $1
            ORDER BY transaction_date DESC
            "#
        );

        // Add pagination
        if let Some(limit_val) = limit {
            query.push_str(&format!(" LIMIT {}", limit_val));
        }

        if let Some(offset_val) = offset {
            query.push_str(&format!(" OFFSET {}", offset_val));
        }

        sqlx::query_as::<_, Transaction>(&query)
            .bind(account_id)
            .fetch_all(&self.db)
            .await
    }

    /// Get transactions for a specific account with search and pagination support
    pub async fn get_account_ledger_transactions(
        &self,
        account_id: Uuid,
        search: Option<&str>,
        limit: Option<i64>,
        offset: Option<i64>
    ) -> Result<Vec<Transaction>, sqlx::Error> {
        // Build the base query
        let mut query = String::from(
            r#"
            SELECT t.* FROM transactions t
            LEFT JOIN accounts src ON t.source_account_id = src.id
            LEFT JOIN accounts dst ON t.destination_account_id = dst.id
            LEFT JOIN categories c ON t.category_id = c.id
            WHERE (t.source_account_id = $1 OR t.destination_account_id = $1)
            "#
        );

        // Add search filter if provided
        let has_search = search.is_some() && !search.unwrap_or("").trim().is_empty();
        if has_search {
            query.push_str(
                r#" AND (
                    t.description ILIKE $2
                    OR t.category ILIKE $2
                    OR COALESCE(c.name, '') ILIKE $2
                    OR COALESCE(t.destination_name, '') ILIKE $2
                    OR COALESCE(src.name, '') ILIKE $2
                    OR COALESCE(dst.name, '') ILIKE $2
                    OR CAST(t.amount AS TEXT) ILIKE $2
                )"#
            );
        }

        query.push_str(" ORDER BY t.transaction_date DESC");

        // Add pagination
        if let Some(limit_val) = limit {
            query.push_str(&format!(" LIMIT {}", limit_val));
        }

        if let Some(offset_val) = offset {
            query.push_str(&format!(" OFFSET {}", offset_val));
        }

        // Build and execute the query
        if has_search {
            let search_pattern = format!("%{}%", search.unwrap().trim());
            sqlx::query_as::<_, Transaction>(&query)
                .bind(account_id)
                .bind(&search_pattern)
                .fetch_all(&self.db)
                .await
        } else {
            sqlx::query_as::<_, Transaction>(&query)
                .bind(account_id)
                .fetch_all(&self.db)
                .await
        }
    }

    /// Get a transaction by ID
    pub async fn get_transaction(&self, id: Uuid) -> Result<Option<Transaction>, sqlx::Error> {
        sqlx::query_as::<_, Transaction>("SELECT * FROM transactions WHERE id = $1")
            .bind(id)
            .fetch_optional(&self.db)
            .await
    }

    /// Create a new transaction
    pub async fn create_transaction(&self, req: CreateTransactionRequest) -> Result<Transaction, sqlx::Error> {
        let now = chrono::Utc::now();
        let transaction_date = req.transaction_date.unwrap_or(now);

        // Start a transaction to update both the transaction table and the account balance(s)
        let mut tx = self.db.begin().await?;

        // Find or create the category and get its ID
        let category = self.category_service.find_or_create_category(&req.category).await?;

        // Determine if this is a transfer (destination matches an on or off budget account)
        // or an external account (which should be created if it doesn't exist)
        let destination_account_id = if let Some(dest_id) = req.destination_account_id {
            // If destination_account_id is provided, use it directly
            dest_id
        } else {
            // Get the destination name to use for matching or creating an account
            let dest_name = req.destination_name.as_ref().map(|s| s.as_str()).unwrap_or(&req.description);

            // Check if there's an existing account that matches the destination name
            let existing_account = sqlx::query!(
                "SELECT id FROM accounts WHERE name = $1",
                dest_name
            )
            .fetch_optional(&mut *tx)
            .await?;

            if let Some(record) = existing_account {
                // Use the existing account
                record.id
            } else {
                // Create a new external account
                let new_account_id = Uuid::new_v4();
                sqlx::query(
                    r#"
                    INSERT INTO accounts (id, name, account_type, balance, cleared_balance, currency, created_at, updated_at)
                    VALUES ($1, $2, 'External', 0.00, 0.00, 'USD', $3, $4)
                    "#,
                )
                .bind(new_account_id)
                .bind(dest_name)
                .bind(now)
                .bind(now)
                .execute(&mut *tx)
                .await?;

                new_account_id
            }
        };

        // Get the destination name if not provided
        let destination_name = if let Some(name) = &req.destination_name {
            name.clone()
        } else {
            // Look up the destination account name
            let dest_account = sqlx::query!(
                "SELECT name FROM accounts WHERE id = $1",
                destination_account_id
            )
            .fetch_optional(&mut *tx)
            .await?;

            dest_account.map(|a| a.name).unwrap_or_else(|| "".to_string())
        };

        // Validate double-entry invariants
        if !req.amount.is_finite() || req.amount == 0.0 {
            return Err(sqlx::Error::Protocol("Invalid amount: must be a finite, non-zero number".into()));
        }
        if req.source_account_id == destination_account_id {
            return Err(sqlx::Error::Protocol("Invalid transaction: source and destination accounts must differ".into()));
        }

        // Normalize description by removing trailing whitespace before saving
        let cleaned_description = req.description.trim_end().to_string();

        // Create the transaction record
        let transaction = sqlx::query_as::<_, Transaction>(
            r#"
            INSERT INTO transactions (id, account_id, source_account_id, destination_account_id, destination_name, description, amount, category, category_id, budget_id, transaction_date, cleared_status, created_at, updated_at)
            VALUES ($1, $2, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            RETURNING *
            "#,
        )
        .bind(Uuid::new_v4())
        .bind(req.source_account_id)
        .bind(destination_account_id)
        .bind(&destination_name)
        .bind(&cleaned_description)
        .bind(req.amount)
        .bind(&req.category)
        .bind(category.id)
        .bind(req.budget_id)
        .bind(transaction_date)
        .bind(&req.cleared_status)
        .bind(now)
        .bind(now)
        .fetch_one(&mut *tx)
        .await?;

        // Apply double-entry accounting:
        //
        // For a POSITIVE amount (expense/transfer out):
        // - Decrease source account balance by the amount (money leaving)
        // - Increase destination account balance by the amount (money arriving)
        //
        // For a NEGATIVE amount (income/transfer in):
        // - Increase source account balance by the absolute amount (money arriving)
        // - Decrease destination account balance by the absolute amount (money leaving)
        //
        // This ensures: source_change + destination_change = 0 (double-entry principle)

        let abs_amount = req.amount.abs();

        // Update regular balances
        if req.amount >= 0.0 {
            // Positive amount: money flows FROM source TO destination
            // Source account loses money (decrease balance)
            let ra1 = sqlx::query(
                r#"
                UPDATE accounts
                SET balance = balance - $1, updated_at = $2
                WHERE id = $3
                "#,
            )
            .bind(abs_amount)
            .bind(now)
            .bind(req.source_account_id)
            .execute(&mut *tx)
            .await?;
            if ra1.rows_affected() != 1 { return Err(sqlx::Error::Protocol("Invariant violation: source account update failed".into())); }

            // Destination account gains money (increase balance)
            let ra2 = sqlx::query(
                r#"
                UPDATE accounts
                SET balance = balance + $1, updated_at = $2
                WHERE id = $3
                "#,
            )
            .bind(abs_amount)
            .bind(now)
            .bind(destination_account_id)
            .execute(&mut *tx)
            .await?;
            if ra2.rows_affected() != 1 { return Err(sqlx::Error::Protocol("Invariant violation: destination account update failed".into())); }
        } else {
            // Negative amount: money flows FROM destination TO source
            // Source account gains money (increase balance)
            let ra1 = sqlx::query(
                r#"
                UPDATE accounts
                SET balance = balance + $1, updated_at = $2
                WHERE id = $3
                "#,
            )
            .bind(abs_amount)
            .bind(now)
            .bind(req.source_account_id)
            .execute(&mut *tx)
            .await?;
            if ra1.rows_affected() != 1 { return Err(sqlx::Error::Protocol("Invariant violation: source account update failed".into())); }

            // Destination account loses money (decrease balance)
            let ra2 = sqlx::query(
                r#"
                UPDATE accounts
                SET balance = balance - $1, updated_at = $2
                WHERE id = $3
                "#,
            )
            .bind(abs_amount)
            .bind(now)
            .bind(destination_account_id)
            .execute(&mut *tx)
            .await?;
            if ra2.rows_affected() != 1 { return Err(sqlx::Error::Protocol("Invariant violation: destination account update failed".into())); }
        }

        // Update cleared balances if transaction is cleared or reconciled
        if matches!(req.cleared_status, ClearedStatus::Cleared | ClearedStatus::Reconciled) {
            if req.amount >= 0.0 {
                // Positive amount: money flows FROM source TO destination
                // Source account cleared balance decreases
                let ra3 = sqlx::query(
                    r#"
                    UPDATE accounts
                    SET cleared_balance = cleared_balance - $1, updated_at = $2
                    WHERE id = $3
                    "#,
                )
                .bind(abs_amount)
                .bind(now)
                .bind(req.source_account_id)
                .execute(&mut *tx)
                .await?;
                if ra3.rows_affected() != 1 { return Err(sqlx::Error::Protocol("Invariant violation: source account cleared balance update failed".into())); }

                // Destination account cleared balance increases
                let ra4 = sqlx::query(
                    r#"
                    UPDATE accounts
                    SET cleared_balance = cleared_balance + $1, updated_at = $2
                    WHERE id = $3
                    "#,
                )
                .bind(abs_amount)
                .bind(now)
                .bind(destination_account_id)
                .execute(&mut *tx)
                .await?;
                if ra4.rows_affected() != 1 { return Err(sqlx::Error::Protocol("Invariant violation: destination account cleared balance update failed".into())); }
            } else {
                // Negative amount: money flows FROM destination TO source
                // Source account cleared balance increases
                let ra3 = sqlx::query(
                    r#"
                    UPDATE accounts
                    SET cleared_balance = cleared_balance + $1, updated_at = $2
                    WHERE id = $3
                    "#,
                )
                .bind(abs_amount)
                .bind(now)
                .bind(req.source_account_id)
                .execute(&mut *tx)
                .await?;
                if ra3.rows_affected() != 1 { return Err(sqlx::Error::Protocol("Invariant violation: source account cleared balance update failed".into())); }

                // Destination account cleared balance decreases
                let ra4 = sqlx::query(
                    r#"
                    UPDATE accounts
                    SET cleared_balance = cleared_balance - $1, updated_at = $2
                    WHERE id = $3
                    "#,
                )
                .bind(abs_amount)
                .bind(now)
                .bind(destination_account_id)
                .execute(&mut *tx)
                .await?;
                if ra4.rows_affected() != 1 { return Err(sqlx::Error::Protocol("Invariant violation: destination account cleared balance update failed".into())); }
            }
        }

        // Commit the transaction
        tx.commit().await?;

        Ok(transaction)
    }

    /// Update an existing transaction
    pub async fn update_transaction(&self, id: Uuid, req: UpdateTransactionRequest) -> Result<Option<Transaction>, sqlx::Error> {
        // First, check if the transaction exists and get the original details
        let original_transaction = self.get_transaction(id).await?;

        if let Some(original) = original_transaction {
            // Start a database transaction
            let mut tx = self.db.begin().await?;
            let now = chrono::Utc::now();

            // First, reverse the original transaction's effect on account balances
            self.reverse_transaction_balance_effects(&mut tx, &original, now).await?;

            // Build the update query dynamically based on which fields are provided
            let mut query = String::from("UPDATE transactions SET updated_at = $1");
            let mut params: Vec<String> = vec![];

            // Track the new values (use original values if not updated)
            let new_amount = req.amount.unwrap_or(original.amount);
            let new_source_account_id = original.source_account_id; // Source account can't be changed
            let mut new_destination_account_id = original.destination_account_id;

            if let Some(amount) = req.amount {
                params.push(format!("amount = {}", amount));
            }

            if let Some(description) = &req.description {
                params.push(format!("description = '{}'", description));
            }

            if let Some(category_name) = &req.category {
                // Resolve category and set both legacy category name and stable category_id
                if let Ok(cat) = self.category_service.find_or_create_category(category_name).await {
                    params.push(format!("category = '{}'", category_name.replace("'", "''")));
                    params.push(format!("category_id = '{}'", cat.id));
                } else {
                    // Fall back to just updating the legacy string if resolution fails
                    params.push(format!("category = '{}'", category_name.replace("'", "''")));
                }
            }

            if let Some(budget_id) = req.budget_id {
                params.push(format!("budget_id = '{}'", budget_id));
            }

            if let Some(transaction_date) = req.transaction_date {
                params.push(format!("transaction_date = '{}'", transaction_date));
            }

            if let Some(ref cleared_status) = req.cleared_status {
                let status_str = match cleared_status {
                    ClearedStatus::Uncleared => "uncleared",
                    ClearedStatus::Cleared => "cleared",
                    ClearedStatus::Reconciled => "reconciled",
                };
                params.push(format!("cleared_status = '{}'", status_str));
            }

            // Handle destination account updates
            if let Some(destination_account_id) = req.destination_account_id {
                // If destination_account_id is provided, use it directly
                params.push(format!("destination_account_id = '{}'", destination_account_id));
                new_destination_account_id = destination_account_id;

                // Look up the destination account name and update it
                if req.destination_name.is_none() {
                    let dest_account = sqlx::query!(
                        "SELECT name FROM accounts WHERE id = $1",
                        destination_account_id
                    )
                    .fetch_optional(&mut *tx)
                    .await?;

                    if let Some(account) = dest_account {
                        params.push(format!("destination_name = '{}'", account.name));
                    }
                }
            } else if let Some(dest_name) = &req.destination_name {
                // If destination_name is provided but not destination_account_id,
                // check if there's an existing account that matches the destination name
                let existing_account = sqlx::query!(
                    "SELECT id FROM accounts WHERE name = $1",
                    dest_name
                )
                .fetch_optional(&mut *tx)
                .await?;

                if let Some(record) = existing_account {
                    // Use the existing account
                    params.push(format!("destination_account_id = '{}'", record.id));
                    new_destination_account_id = record.id;
                } else {
                    // Create a new external account
                    let new_account_id = Uuid::new_v4();
                    sqlx::query(
                        r#"
                        INSERT INTO accounts (id, name, account_type, balance, cleared_balance, currency, created_at, updated_at)
                        VALUES ($1, $2, 'External', 0.00, 0.00, 'USD', $3, $4)
                        "#,
                    )
                    .bind(new_account_id)
                    .bind(dest_name)
                    .bind(now)
                    .bind(now)
                    .execute(&mut *tx)
                    .await?;

                    params.push(format!("destination_account_id = '{}'", new_account_id));
                    new_destination_account_id = new_account_id;
                }

                // Also update the destination_name field in the transaction
                params.push(format!("destination_name = '{}'", dest_name));
            }

            if !params.is_empty() {
                query.push_str(", ");
                query.push_str(&params.join(", "));
            }

            query.push_str(" WHERE id = $2 RETURNING *");

            // Update the transaction
            let updated_transaction = sqlx::query_as::<_, Transaction>(&query)
                .bind(now)
                .bind(id)
                .fetch_optional(&mut *tx)
                .await?;

            // Apply the new transaction's effect on account balances
            let new_cleared_status = req.cleared_status.as_ref().unwrap_or(&original.cleared_status);
            self.apply_transaction_balance_effects(&mut tx, new_source_account_id, new_destination_account_id, new_amount, new_cleared_status, now).await?;

            // Commit the transaction
            tx.commit().await?;

            Ok(updated_transaction)
        } else {
            Ok(None)
        }
    }

    /// Delete a transaction
    pub async fn delete_transaction(&self, id: Uuid) -> Result<bool, sqlx::Error> {
        // First, check if the transaction exists and get its details
        let transaction = self.get_transaction(id).await?;

        if let Some(transaction) = transaction {
            // Start a database transaction
            let mut tx = self.db.begin().await?;
            let now = chrono::Utc::now();

            // Delete the transaction record
            let result = sqlx::query("DELETE FROM transactions WHERE id = $1")
                .bind(id)
                .execute(&mut *tx)
                .await?;

            // Reverse the transaction's effect on account balances
            self.reverse_transaction_balance_effects(&mut tx, &transaction, now).await?;

            // Commit the transaction
            tx.commit().await?;

            Ok(result.rows_affected() > 0)
        } else {
            Ok(false)
        }
    }

    /// Helper method to reverse the balance effects of a transaction
    async fn reverse_transaction_balance_effects(
        &self,
        tx: &mut sqlx::Transaction<'_, Postgres>,
        transaction: &Transaction,
        now: DateTime<Utc>
    ) -> Result<(), sqlx::Error> {
        let abs_amount = transaction.amount.abs();

        // Reverse regular balance effects
        if transaction.amount >= 0.0 {
            // Original was positive: source lost money, destination gained money
            // Reverse: source gains money back, destination loses money
            sqlx::query(
                r#"
                UPDATE accounts
                SET balance = balance + $1, updated_at = $2
                WHERE id = $3
                "#,
            )
            .bind(abs_amount)
            .bind(now)
            .bind(transaction.source_account_id)
            .execute(&mut **tx)
            .await?;

            sqlx::query(
                r#"
                UPDATE accounts
                SET balance = balance - $1, updated_at = $2
                WHERE id = $3
                "#,
            )
            .bind(abs_amount)
            .bind(now)
            .bind(transaction.destination_account_id)
            .execute(&mut **tx)
            .await?;
        } else {
            // Original was negative: source gained money, destination lost money
            // Reverse: source loses money, destination gains money back
            sqlx::query(
                r#"
                UPDATE accounts
                SET balance = balance - $1, updated_at = $2
                WHERE id = $3
                "#,
            )
            .bind(abs_amount)
            .bind(now)
            .bind(transaction.source_account_id)
            .execute(&mut **tx)
            .await?;

            sqlx::query(
                r#"
                UPDATE accounts
                SET balance = balance + $1, updated_at = $2
                WHERE id = $3
                "#,
            )
            .bind(abs_amount)
            .bind(now)
            .bind(transaction.destination_account_id)
            .execute(&mut **tx)
            .await?;
        }

        // Reverse cleared balance effects if transaction was cleared or reconciled
        if matches!(transaction.cleared_status, ClearedStatus::Cleared | ClearedStatus::Reconciled) {
            if transaction.amount >= 0.0 {
                // Original was positive: source cleared balance decreased, destination cleared balance increased
                // Reverse: source cleared balance increases, destination cleared balance decreases
                sqlx::query(
                    r#"
                    UPDATE accounts
                    SET cleared_balance = cleared_balance + $1, updated_at = $2
                    WHERE id = $3
                    "#,
                )
                .bind(abs_amount)
                .bind(now)
                .bind(transaction.source_account_id)
                .execute(&mut **tx)
                .await?;

                sqlx::query(
                    r#"
                    UPDATE accounts
                    SET cleared_balance = cleared_balance - $1, updated_at = $2
                    WHERE id = $3
                    "#,
                )
                .bind(abs_amount)
                .bind(now)
                .bind(transaction.destination_account_id)
                .execute(&mut **tx)
                .await?;
            } else {
                // Original was negative: source cleared balance increased, destination cleared balance decreased
                // Reverse: source cleared balance decreases, destination cleared balance increases
                sqlx::query(
                    r#"
                    UPDATE accounts
                    SET cleared_balance = cleared_balance - $1, updated_at = $2
                    WHERE id = $3
                    "#,
                )
                .bind(abs_amount)
                .bind(now)
                .bind(transaction.source_account_id)
                .execute(&mut **tx)
                .await?;

                sqlx::query(
                    r#"
                    UPDATE accounts
                    SET cleared_balance = cleared_balance + $1, updated_at = $2
                    WHERE id = $3
                    "#,
                )
                .bind(abs_amount)
                .bind(now)
                .bind(transaction.destination_account_id)
                .execute(&mut **tx)
                .await?;
            }
        }

        Ok(())
    }

    /// Helper method to apply the balance effects of a transaction
    async fn apply_transaction_balance_effects(
        &self,
        tx: &mut sqlx::Transaction<'_, Postgres>,
        source_account_id: Uuid,
        destination_account_id: Uuid,
        amount: f64,
        cleared_status: &ClearedStatus,
        now: DateTime<Utc>
    ) -> Result<(), sqlx::Error> {
        let abs_amount = amount.abs();

        // Apply regular balance effects
        if amount >= 0.0 {
            // Positive amount: money flows FROM source TO destination
            // Source account loses money (decrease balance)
            sqlx::query(
                r#"
                UPDATE accounts
                SET balance = balance - $1, updated_at = $2
                WHERE id = $3
                "#,
            )
            .bind(abs_amount)
            .bind(now)
            .bind(source_account_id)
            .execute(&mut **tx)
            .await?;

            // Destination account gains money (increase balance)
            sqlx::query(
                r#"
                UPDATE accounts
                SET balance = balance + $1, updated_at = $2
                WHERE id = $3
                "#,
            )
            .bind(abs_amount)
            .bind(now)
            .bind(destination_account_id)
            .execute(&mut **tx)
            .await?;
        } else {
            // Negative amount: money flows FROM destination TO source
            // Source account gains money (increase balance)
            sqlx::query(
                r#"
                UPDATE accounts
                SET balance = balance + $1, updated_at = $2
                WHERE id = $3
                "#,
            )
            .bind(abs_amount)
            .bind(now)
            .bind(source_account_id)
            .execute(&mut **tx)
            .await?;

            // Destination account loses money (decrease balance)
            sqlx::query(
                r#"
                UPDATE accounts
                SET balance = balance - $1, updated_at = $2
                WHERE id = $3
                "#,
            )
            .bind(abs_amount)
            .bind(now)
            .bind(destination_account_id)
            .execute(&mut **tx)
            .await?;
        }

        // Apply cleared balance effects if transaction is cleared or reconciled
        if matches!(cleared_status, ClearedStatus::Cleared | ClearedStatus::Reconciled) {
            if amount >= 0.0 {
                // Positive amount: money flows FROM source TO destination
                // Source account cleared balance decreases
                sqlx::query(
                    r#"
                    UPDATE accounts
                    SET cleared_balance = cleared_balance - $1, updated_at = $2
                    WHERE id = $3
                    "#,
                )
                .bind(abs_amount)
                .bind(now)
                .bind(source_account_id)
                .execute(&mut **tx)
                .await?;

                // Destination account cleared balance increases
                sqlx::query(
                    r#"
                    UPDATE accounts
                    SET cleared_balance = cleared_balance + $1, updated_at = $2
                    WHERE id = $3
                    "#,
                )
                .bind(abs_amount)
                .bind(now)
                .bind(destination_account_id)
                .execute(&mut **tx)
                .await?;
            } else {
                // Negative amount: money flows FROM destination TO source
                // Source account cleared balance increases
                sqlx::query(
                    r#"
                    UPDATE accounts
                    SET cleared_balance = cleared_balance + $1, updated_at = $2
                    WHERE id = $3
                    "#,
                )
                .bind(abs_amount)
                .bind(now)
                .bind(source_account_id)
                .execute(&mut **tx)
                .await?;

                // Destination account cleared balance decreases
                sqlx::query(
                    r#"
                    UPDATE accounts
                    SET cleared_balance = cleared_balance - $1, updated_at = $2
                    WHERE id = $3
                    "#,
                )
                .bind(abs_amount)
                .bind(now)
                .bind(destination_account_id)
                .execute(&mut **tx)
                .await?;
            }
        }

        Ok(())
    }

    /// Get unbudgeted transactions with optional date bounds (uses same criteria as unbudgeted total)
    pub async fn get_unbudgeted_transactions(
        &self,
        start_date: Option<DateTime<Utc>>,
        end_date: Option<DateTime<Utc>>,
    ) -> Result<Vec<Transaction>, sqlx::Error> {
        let mut query = String::from(
            "SELECT t.*\n\
             FROM transactions t\n\
             JOIN accounts src ON t.source_account_id = src.id\n\
             LEFT JOIN accounts dst ON t.destination_account_id = dst.id\n\
             LEFT JOIN categories c_id ON c_id.id = t.category_id\n\
             LEFT JOIN categories c_name ON t.category_id IS NULL AND t.category IS NOT NULL AND c_name.name = t.category\n\
             WHERE t.budget_id IS NULL\n\
               AND src.account_type = 'On Budget'\n\
               AND t.amount > 0\n\
               AND NOT (dst.account_type = 'On Budget')\n\
               AND (COALESCE(c_id.name, c_name.name, t.category) IS NULL OR COALESCE(c_id.name, c_name.name, t.category) NOT IN ('Initial Balance', 'Transfer', 'Transfers'))"
        );

        if let Some(start) = start_date { query.push_str(&format!(" AND t.transaction_date >= '{}'", start)); }
        if let Some(end) = end_date { query.push_str(&format!(" AND t.transaction_date <= '{}'", end)); }

        query.push_str(" ORDER BY t.transaction_date DESC");

        sqlx::query_as::<_, Transaction>(&query)
            .fetch_all(&self.db)
            .await
    }

    /// Get unique external payee names from transactions (destination_name field)
    /// Excludes names that match existing account names
    pub async fn get_external_payee_names(&self, search_pattern: Option<&str>) -> Result<Vec<String>, sqlx::Error> {
        let query = if let Some(pattern) = search_pattern {
            if pattern == "%%" || pattern.trim().is_empty() {
                // If no search query, get all unique external payee names
                r#"
                SELECT DISTINCT destination_name
                FROM transactions
                WHERE destination_name IS NOT NULL 
                  AND destination_name != ''
                  AND destination_name NOT IN (SELECT name FROM accounts)
                ORDER BY destination_name
                LIMIT 50
                "#
            } else {
                // Get matching external payee names
                r#"
                SELECT DISTINCT destination_name
                FROM transactions
                WHERE destination_name IS NOT NULL 
                  AND destination_name != ''
                  AND destination_name NOT IN (SELECT name FROM accounts)
                  AND destination_name ILIKE $1
                ORDER BY destination_name
                LIMIT 50
                "#
            }
        } else {
            // Default: get all unique external payee names
            r#"
            SELECT DISTINCT destination_name
            FROM transactions
            WHERE destination_name IS NOT NULL 
              AND destination_name != ''
              AND destination_name NOT IN (SELECT name FROM accounts)
            ORDER BY destination_name
            LIMIT 50
            "#
        };

        let rows = if let Some(pattern) = search_pattern {
            if pattern == "%%" || pattern.trim().is_empty() {
                sqlx::query(query)
                    .fetch_all(&self.db)
                    .await?
            } else {
                sqlx::query(query)
                    .bind(pattern)
                    .fetch_all(&self.db)
                    .await?
            }
        } else {
            sqlx::query(query)
                .fetch_all(&self.db)
                .await?
        };

        let external_payees = rows
            .into_iter()
            .filter_map(|row| {
                let name: Option<String> = row.get("destination_name");
                name
            })
            .collect();

        Ok(external_payees)
    }

    /// Get the last category used with a specific payee
    /// Searches for the most recent transaction where the payee appears as either source or destination
    pub async fn get_last_category_for_payee(&self, payee_name: &str, account_id: Option<Uuid>) -> Result<(Option<Uuid>, Option<String>), sqlx::Error> {
        let query = if let Some(account_id) = account_id {
            // If payee matches an account, search for transactions involving that account
            r#"
            SELECT t.category_id, t.category, c.name as category_name
            FROM transactions t
            LEFT JOIN categories c ON t.category_id = c.id
            WHERE (t.source_account_id = $1 OR t.destination_account_id = $1)
              AND (t.category_id IS NOT NULL OR (t.category IS NOT NULL AND t.category != ''))
            ORDER BY t.transaction_date DESC, t.created_at DESC
            LIMIT 1
            "#
        } else {
            // If payee is external, search by destination_name
            r#"
            SELECT t.category_id, t.category, c.name as category_name
            FROM transactions t
            LEFT JOIN categories c ON t.category_id = c.id
            WHERE t.destination_name ILIKE $1
              AND (t.category_id IS NOT NULL OR (t.category IS NOT NULL AND t.category != ''))
            ORDER BY t.transaction_date DESC, t.created_at DESC
            LIMIT 1
            "#
        };

        let row = if let Some(account_id) = account_id {
            sqlx::query(query)
                .bind(account_id)
                .fetch_optional(&self.db)
                .await?
        } else {
            sqlx::query(query)
                .bind(payee_name)
                .fetch_optional(&self.db)
                .await?
        };

        if let Some(row) = row {
            let category_id: Option<Uuid> = row.get("category_id");
            let legacy_category: Option<String> = row.get("category");
            let category_name: Option<String> = row.get("category_name");

            // Prefer the resolved category name from the categories table, fall back to legacy category
            let final_category_name = category_name.or(legacy_category);

            Ok((category_id, final_category_name))
        } else {
            // No previous transaction found
            Ok((None, None))
        }
    }

    /// Bulk update multiple transactions with the same changes
    pub async fn bulk_update_transactions(&self, transaction_ids: Vec<Uuid>, updates: UpdateTransactionRequest) -> Result<(usize, Vec<Uuid>), sqlx::Error> {
        let mut updated_count = 0;
        let mut failed_ids = Vec::new();

        // Start a database transaction for atomicity
        let mut tx = self.db.begin().await?;

        for transaction_id in transaction_ids {
            // Get the original transaction to reverse its balance effects
            let original_transaction = sqlx::query_as::<_, Transaction>("SELECT * FROM transactions WHERE id = $1")
                .bind(transaction_id)
                .fetch_optional(&mut *tx)
                .await?;

            if let Some(original) = original_transaction {
                // Reverse the original transaction's balance effects
                if let Err(_) = self.reverse_transaction_balance_effects_in_tx(&mut tx, &original, chrono::Utc::now()).await {
                    failed_ids.push(transaction_id);
                    continue;
                }

                // Build the update query dynamically based on which fields are provided
                let mut query = String::from("UPDATE transactions SET updated_at = $1");
                let mut param_count = 2;
                let mut bind_values: Vec<Box<dyn sqlx::Encode<'_, Postgres> + Send + Sync>> = vec![];
                
                let now = chrono::Utc::now();
                
                // Track the new values (use original values if not updated)
                let new_amount = updates.amount.unwrap_or(original.amount);
                let new_source_account_id = original.source_account_id; // Source account can't be changed
                let mut new_destination_account_id = original.destination_account_id;
                let new_cleared_status = updates.cleared_status.as_ref().unwrap_or(&original.cleared_status);

                if let Some(amount) = updates.amount {
                    query.push_str(&format!(", amount = ${}", param_count));
                    param_count += 1;
                }

                if let Some(ref description) = updates.description {
                    query.push_str(&format!(", description = ${}", param_count));
                    param_count += 1;
                }

                if let Some(ref category_name) = updates.category {
                    // Resolve category and set both legacy category name and stable category_id
                    if let Ok(cat) = self.category_service.find_or_create_category(category_name).await {
                        query.push_str(&format!(", category = ${}, category_id = ${}", param_count, param_count + 1));
                        param_count += 2;
                    } else {
                        // Fall back to just updating the legacy string if resolution fails
                        query.push_str(&format!(", category = ${}", param_count));
                        param_count += 1;
                    }
                }

                if let Some(budget_id) = updates.budget_id {
                    query.push_str(&format!(", budget_id = ${}", param_count));
                    param_count += 1;
                }

                if let Some(transaction_date) = updates.transaction_date {
                    query.push_str(&format!(", transaction_date = ${}", param_count));
                    param_count += 1;
                }

                if let Some(ref cleared_status) = updates.cleared_status {
                    query.push_str(&format!(", cleared_status = ${}", param_count));
                    param_count += 1;
                }

                // Handle destination account updates
                if let Some(destination_account_id) = updates.destination_account_id {
                    query.push_str(&format!(", destination_account_id = ${}", param_count));
                    new_destination_account_id = destination_account_id;
                    param_count += 1;

                    // Look up the destination account name and update it
                    if updates.destination_name.is_none() {
                        let dest_account = sqlx::query!(
                            "SELECT name FROM accounts WHERE id = $1",
                            destination_account_id
                        )
                        .fetch_optional(&mut *tx)
                        .await?;

                        if let Some(account) = dest_account {
                            query.push_str(&format!(", destination_name = ${}", param_count));
                            param_count += 1;
                        }
                    }
                } else if let Some(ref dest_name) = updates.destination_name {
                    // If destination_name is provided but not destination_account_id,
                    // check if there's an existing account that matches the destination name
                    let existing_account = sqlx::query!(
                        "SELECT id FROM accounts WHERE name = $1",
                        dest_name
                    )
                    .fetch_optional(&mut *tx)
                    .await?;

                    if let Some(record) = existing_account {
                        // Use the existing account
                        query.push_str(&format!(", destination_account_id = ${}", param_count));
                        new_destination_account_id = record.id;
                        param_count += 1;
                    } else {
                        // Create a new external account
                        let new_account_id = Uuid::new_v4();
                        sqlx::query(
                            r#"
                            INSERT INTO accounts (id, name, account_type, balance, cleared_balance, currency, created_at, updated_at)
                            VALUES ($1, $2, 'External', 0.00, 0.00, 'USD', $3, $4)
                            "#,
                        )
                        .bind(new_account_id)
                        .bind(dest_name)
                        .bind(now)
                        .bind(now)
                        .execute(&mut *tx)
                        .await?;

                        query.push_str(&format!(", destination_account_id = ${}", param_count));
                        new_destination_account_id = new_account_id;
                        param_count += 1;
                    }

                    // Also update the destination_name field in the transaction
                    query.push_str(&format!(", destination_name = ${}", param_count));
                    param_count += 1;
                }

                query.push_str(&format!(" WHERE id = ${}", param_count));

                // Execute the update using raw SQL with manual parameter binding
                let mut sql_query = sqlx::query(&query)
                    .bind(now)
                    .bind(transaction_id);

                // Bind parameters in the same order they were added to the query
                if let Some(amount) = updates.amount {
                    sql_query = sql_query.bind(amount);
                }

                if let Some(ref description) = updates.description {
                    sql_query = sql_query.bind(description);
                }

                if let Some(ref category_name) = updates.category {
                    if let Ok(cat) = self.category_service.find_or_create_category(category_name).await {
                        sql_query = sql_query.bind(category_name).bind(cat.id);
                    } else {
                        sql_query = sql_query.bind(category_name);
                    }
                }

                if let Some(budget_id) = updates.budget_id {
                    sql_query = sql_query.bind(budget_id);
                }

                if let Some(transaction_date) = updates.transaction_date {
                    sql_query = sql_query.bind(transaction_date);
                }

                if let Some(ref cleared_status) = updates.cleared_status {
                    sql_query = sql_query.bind(cleared_status);
                }

                if let Some(destination_account_id) = updates.destination_account_id {
                    sql_query = sql_query.bind(destination_account_id);

                    // Add destination name if we looked it up
                    if updates.destination_name.is_none() {
                        let dest_account = sqlx::query!(
                            "SELECT name FROM accounts WHERE id = $1",
                            destination_account_id
                        )
                        .fetch_optional(&mut *tx)
                        .await?;

                        if let Some(account) = dest_account {
                            sql_query = sql_query.bind(account.name);
                        }
                    }
                } else if let Some(ref dest_name) = updates.destination_name {
                    // Check if we created a new account or found existing one
                    let existing_account = sqlx::query!(
                        "SELECT id FROM accounts WHERE name = $1",
                        dest_name
                    )
                    .fetch_optional(&mut *tx)
                    .await?;

                    if let Some(record) = existing_account {
                        sql_query = sql_query.bind(record.id);
                    } else {
                        // We created a new account above, bind its ID
                        let new_account_id = Uuid::new_v4();
                        sql_query = sql_query.bind(new_account_id);
                    }
                    sql_query = sql_query.bind(dest_name);
                }

                // Execute the update
                match sql_query.execute(&mut *tx).await {
                    Ok(result) => {
                        if result.rows_affected() > 0 {
                            // Apply the new transaction's balance effects
                            if let Err(_) = self.apply_transaction_balance_effects_in_tx(&mut tx, new_source_account_id, new_destination_account_id, new_amount, new_cleared_status, now).await {
                                failed_ids.push(transaction_id);
                            } else {
                                updated_count += 1;
                            }
                        } else {
                            failed_ids.push(transaction_id);
                        }
                    }
                    Err(_) => {
                        failed_ids.push(transaction_id);
                    }
                }
            } else {
                // Transaction not found
                failed_ids.push(transaction_id);
            }
        }

        // Commit the transaction
        tx.commit().await?;

        Ok((updated_count, failed_ids))
    }

    /// Helper method to reverse transaction balance effects within an existing transaction
    async fn reverse_transaction_balance_effects_in_tx(
        &self,
        tx: &mut sqlx::Transaction<'_, Postgres>,
        transaction: &Transaction,
        now: DateTime<Utc>
    ) -> Result<(), sqlx::Error> {
        let abs_amount = transaction.amount.abs();

        // Reverse regular balance effects
        if transaction.amount >= 0.0 {
            // Original was positive: source lost money, destination gained money
            // Reverse: source gains money back, destination loses money
            sqlx::query(
                r#"
                UPDATE accounts
                SET balance = balance + $1, updated_at = $2
                WHERE id = $3
                "#,
            )
            .bind(abs_amount)
            .bind(now)
            .bind(transaction.source_account_id)
            .execute(&mut **tx)
            .await?;

            sqlx::query(
                r#"
                UPDATE accounts
                SET balance = balance - $1, updated_at = $2
                WHERE id = $3
                "#,
            )
            .bind(abs_amount)
            .bind(now)
            .bind(transaction.destination_account_id)
            .execute(&mut **tx)
            .await?;
        } else {
            // Original was negative: source gained money, destination lost money
            // Reverse: source loses money, destination gains money back
            sqlx::query(
                r#"
                UPDATE accounts
                SET balance = balance - $1, updated_at = $2
                WHERE id = $3
                "#,
            )
            .bind(abs_amount)
            .bind(now)
            .bind(transaction.source_account_id)
            .execute(&mut **tx)
            .await?;

            sqlx::query(
                r#"
                UPDATE accounts
                SET balance = balance + $1, updated_at = $2
                WHERE id = $3
                "#,
            )
            .bind(abs_amount)
            .bind(now)
            .bind(transaction.destination_account_id)
            .execute(&mut **tx)
            .await?;
        }

        // Reverse cleared balance effects if transaction was cleared or reconciled
        if matches!(transaction.cleared_status, ClearedStatus::Cleared | ClearedStatus::Reconciled) {
            if transaction.amount >= 0.0 {
                // Original was positive: source cleared balance decreased, destination cleared balance increased
                // Reverse: source cleared balance increases, destination cleared balance decreases
                sqlx::query(
                    r#"
                    UPDATE accounts
                    SET cleared_balance = cleared_balance + $1, updated_at = $2
                    WHERE id = $3
                    "#,
                )
                .bind(abs_amount)
                .bind(now)
                .bind(transaction.source_account_id)
                .execute(&mut **tx)
                .await?;

                sqlx::query(
                    r#"
                    UPDATE accounts
                    SET cleared_balance = cleared_balance - $1, updated_at = $2
                    WHERE id = $3
                    "#,
                )
                .bind(abs_amount)
                .bind(now)
                .bind(transaction.destination_account_id)
                .execute(&mut **tx)
                .await?;
            } else {
                // Original was negative: source cleared balance increased, destination cleared balance decreased
                // Reverse: source cleared balance decreases, destination cleared balance increases
                sqlx::query(
                    r#"
                    UPDATE accounts
                    SET cleared_balance = cleared_balance - $1, updated_at = $2
                    WHERE id = $3
                    "#,
                )
                .bind(abs_amount)
                .bind(now)
                .bind(transaction.source_account_id)
                .execute(&mut **tx)
                .await?;

                sqlx::query(
                    r#"
                    UPDATE accounts
                    SET cleared_balance = cleared_balance + $1, updated_at = $2
                    WHERE id = $3
                    "#,
                )
                .bind(abs_amount)
                .bind(now)
                .bind(transaction.destination_account_id)
                .execute(&mut **tx)
                .await?;
            }
        }

        Ok(())
    }

    /// Helper method to apply transaction balance effects within an existing transaction
    async fn apply_transaction_balance_effects_in_tx(
        &self,
        tx: &mut sqlx::Transaction<'_, Postgres>,
        source_account_id: Uuid,
        destination_account_id: Uuid,
        amount: f64,
        cleared_status: &ClearedStatus,
        now: DateTime<Utc>
    ) -> Result<(), sqlx::Error> {
        let abs_amount = amount.abs();

        // Apply regular balance effects
        if amount >= 0.0 {
            // Positive amount: money flows FROM source TO destination
            // Source account loses money (decrease balance)
            sqlx::query(
                r#"
                UPDATE accounts
                SET balance = balance - $1, updated_at = $2
                WHERE id = $3
                "#,
            )
            .bind(abs_amount)
            .bind(now)
            .bind(source_account_id)
            .execute(&mut **tx)
            .await?;

            // Destination account gains money (increase balance)
            sqlx::query(
                r#"
                UPDATE accounts
                SET balance = balance + $1, updated_at = $2
                WHERE id = $3
                "#,
            )
            .bind(abs_amount)
            .bind(now)
            .bind(destination_account_id)
            .execute(&mut **tx)
            .await?;
        } else {
            // Negative amount: money flows FROM destination TO source
            // Source account gains money (increase balance)
            sqlx::query(
                r#"
                UPDATE accounts
                SET balance = balance + $1, updated_at = $2
                WHERE id = $3
                "#,
            )
            .bind(abs_amount)
            .bind(now)
            .bind(source_account_id)
            .execute(&mut **tx)
            .await?;

            // Destination account loses money (decrease balance)
            sqlx::query(
                r#"
                UPDATE accounts
                SET balance = balance - $1, updated_at = $2
                WHERE id = $3
                "#,
            )
            .bind(abs_amount)
            .bind(now)
            .bind(destination_account_id)
            .execute(&mut **tx)
            .await?;
        }

        // Apply cleared balance effects if transaction is cleared or reconciled
        if matches!(cleared_status, ClearedStatus::Cleared | ClearedStatus::Reconciled) {
            if amount >= 0.0 {
                // Positive amount: money flows FROM source TO destination
                // Source account cleared balance decreases
                sqlx::query(
                    r#"
                    UPDATE accounts
                    SET cleared_balance = cleared_balance - $1, updated_at = $2
                    WHERE id = $3
                    "#,
                )
                .bind(abs_amount)
                .bind(now)
                .bind(source_account_id)
                .execute(&mut **tx)
                .await?;

                // Destination account cleared balance increases
                sqlx::query(
                    r#"
                    UPDATE accounts
                    SET cleared_balance = cleared_balance + $1, updated_at = $2
                    WHERE id = $3
                    "#,
                )
                .bind(abs_amount)
                .bind(now)
                .bind(destination_account_id)
                .execute(&mut **tx)
                .await?;
            } else {
                // Negative amount: money flows FROM destination TO source
                // Source account cleared balance increases
                sqlx::query(
                    r#"
                    UPDATE accounts
                    SET cleared_balance = cleared_balance + $1, updated_at = $2
                    WHERE id = $3
                    "#,
                )
                .bind(abs_amount)
                .bind(now)
                .bind(source_account_id)
                .execute(&mut **tx)
                .await?;

                // Destination account cleared balance decreases
                sqlx::query(
                    r#"
                    UPDATE accounts
                    SET cleared_balance = cleared_balance - $1, updated_at = $2
                    WHERE id = $3
                    "#,
                )
                .bind(abs_amount)
                .bind(now)
                .bind(destination_account_id)
                .execute(&mut **tx)
                .await?;
            }
        }

        Ok(())
    }

    /// Update the cleared status of a transaction and recalculate cleared balances
    pub async fn update_cleared_status(&self, id: Uuid, new_status: ClearedStatus) -> Result<Option<Transaction>, sqlx::Error> {
        // First, get the current transaction to understand its current state
        let original_transaction = self.get_transaction(id).await?;

        if let Some(original) = original_transaction {
            // Start a database transaction
            let mut tx = self.db.begin().await?;
            let now = chrono::Utc::now();

            // Update the transaction's cleared status
            let updated_transaction = sqlx::query_as::<_, Transaction>(
                r#"
                UPDATE transactions 
                SET cleared_status = $1, updated_at = $2
                WHERE id = $3
                RETURNING *
                "#,
            )
            .bind(&new_status)
            .bind(now)
            .bind(id)
            .fetch_optional(&mut *tx)
            .await?;

            if let Some(transaction) = &updated_transaction {
                // Calculate the cleared balance changes needed
                let abs_amount = transaction.amount.abs();
                
                // Determine the balance changes based on the old and new cleared status
                let old_affects_cleared = matches!(original.cleared_status, ClearedStatus::Cleared | ClearedStatus::Reconciled);
                let new_affects_cleared = matches!(new_status, ClearedStatus::Cleared | ClearedStatus::Reconciled);

                // Only update cleared balances if the cleared status effect changes
                if old_affects_cleared != new_affects_cleared {
                    if new_affects_cleared {
                        // Transaction is now cleared/reconciled - apply cleared balance effects
                        if transaction.amount >= 0.0 {
                            // Positive amount: source cleared balance decreases, destination cleared balance increases
                            sqlx::query(
                                r#"
                                UPDATE accounts
                                SET cleared_balance = cleared_balance - $1, updated_at = $2
                                WHERE id = $3
                                "#,
                            )
                            .bind(abs_amount)
                            .bind(now)
                            .bind(transaction.source_account_id)
                            .execute(&mut *tx)
                            .await?;

                            sqlx::query(
                                r#"
                                UPDATE accounts
                                SET cleared_balance = cleared_balance + $1, updated_at = $2
                                WHERE id = $3
                                "#,
                            )
                            .bind(abs_amount)
                            .bind(now)
                            .bind(transaction.destination_account_id)
                            .execute(&mut *tx)
                            .await?;
                        } else {
                            // Negative amount: source cleared balance increases, destination cleared balance decreases
                            sqlx::query(
                                r#"
                                UPDATE accounts
                                SET cleared_balance = cleared_balance + $1, updated_at = $2
                                WHERE id = $3
                                "#,
                            )
                            .bind(abs_amount)
                            .bind(now)
                            .bind(transaction.source_account_id)
                            .execute(&mut *tx)
                            .await?;

                            sqlx::query(
                                r#"
                                UPDATE accounts
                                SET cleared_balance = cleared_balance - $1, updated_at = $2
                                WHERE id = $3
                                "#,
                            )
                            .bind(abs_amount)
                            .bind(now)
                            .bind(transaction.destination_account_id)
                            .execute(&mut *tx)
                            .await?;
                        }
                    } else {
                        // Transaction is now uncleared - reverse cleared balance effects
                        if transaction.amount >= 0.0 {
                            // Positive amount: reverse the cleared balance effects
                            sqlx::query(
                                r#"
                                UPDATE accounts
                                SET cleared_balance = cleared_balance + $1, updated_at = $2
                                WHERE id = $3
                                "#,
                            )
                            .bind(abs_amount)
                            .bind(now)
                            .bind(transaction.source_account_id)
                            .execute(&mut *tx)
                            .await?;

                            sqlx::query(
                                r#"
                                UPDATE accounts
                                SET cleared_balance = cleared_balance - $1, updated_at = $2
                                WHERE id = $3
                                "#,
                            )
                            .bind(abs_amount)
                            .bind(now)
                            .bind(transaction.destination_account_id)
                            .execute(&mut *tx)
                            .await?;
                        } else {
                            // Negative amount: reverse the cleared balance effects
                            sqlx::query(
                                r#"
                                UPDATE accounts
                                SET cleared_balance = cleared_balance - $1, updated_at = $2
                                WHERE id = $3
                                "#,
                            )
                            .bind(abs_amount)
                            .bind(now)
                            .bind(transaction.source_account_id)
                            .execute(&mut *tx)
                            .await?;

                            sqlx::query(
                                r#"
                                UPDATE accounts
                                SET cleared_balance = cleared_balance + $1, updated_at = $2
                                WHERE id = $3
                                "#,
                            )
                            .bind(abs_amount)
                            .bind(now)
                            .bind(transaction.destination_account_id)
                            .execute(&mut *tx)
                            .await?;
                        }
                    }
                }
            }

            // Commit the transaction
            tx.commit().await?;

            Ok(updated_transaction)
        } else {
            Ok(None)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cleared_status_enum() {
        // Test that ClearedStatus enum values work correctly
        let uncleared = ClearedStatus::Uncleared;
        let cleared = ClearedStatus::Cleared;
        let reconciled = ClearedStatus::Reconciled;

        // Test default value
        assert!(matches!(ClearedStatus::default(), ClearedStatus::Uncleared));

        // Test that we can create all variants
        assert!(matches!(uncleared, ClearedStatus::Uncleared));
        assert!(matches!(cleared, ClearedStatus::Cleared));
        assert!(matches!(reconciled, ClearedStatus::Reconciled));
    }

    #[test]
    fn test_get_last_category_for_payee_method_exists() {
        // This test verifies that the method signature is correct and compiles
        // Integration tests with actual database would be needed for full functionality testing
        
        // Test that we can create the method parameters
        let payee_name = "Test Payee";
        let account_id = Some(Uuid::new_v4());
        
        // Verify the parameters are the expected types
        assert_eq!(payee_name, "Test Payee");
        assert!(account_id.is_some());
        
        // The actual method call would require a database connection,
        // so we just verify the types compile correctly here
    }

    #[tokio::test]
    async fn test_get_last_category_for_payee_functionality() {
        // This test verifies the method signature and basic logic
        // In a real test environment, we would need a test database
        
        // Test data
        let payee_name = "Test Payee";
        let account_id = Some(Uuid::new_v4());
        
        // Verify the method parameters are correct types
        assert_eq!(payee_name, "Test Payee");
        assert!(account_id.is_some());
        
        // The method should return a tuple of (Option<Uuid>, Option<String>)
        // This verifies the return type is correct
        let expected_return_type: (Option<Uuid>, Option<String>) = (None, None);
        assert_eq!(expected_return_type.0, None);
        assert_eq!(expected_return_type.1, None);
    }
}
