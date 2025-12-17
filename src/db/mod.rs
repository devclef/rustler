use sqlx::{postgres::PgPoolOptions, Pool, Postgres};
use std::time::Duration;

mod migrations;
mod double_entry_migration;
mod fix_null_destination_migration;
mod add_destination_name_migration;
mod update_destination_account_type_migration;
mod settings_migration;
mod category_groups_migration;
mod budget_groups_migration;
mod account_sub_type_migration;
mod rule_groups_migration;
mod cleared_status_migration;

pub use migrations::run_migrations;
pub use double_entry_migration::migrate_to_double_entry;
pub use fix_null_destination_migration::fix_null_destination_accounts;
pub use add_destination_name_migration::add_destination_name_column;
pub use update_destination_account_type_migration::update_destination_account_type;
pub use settings_migration::add_settings_table;
pub use category_groups_migration::add_category_groups;
pub use budget_groups_migration::add_budget_groups as add_budget_groups_migration;
pub use account_sub_type_migration::add_account_sub_type;
pub use rule_groups_migration::add_rule_groups;
pub use cleared_status_migration::add_cleared_status;

/// Initialize a connection pool to the database
pub async fn init_db_pool(database_url: &str) -> Result<Pool<Postgres>, sqlx::Error> {
    PgPoolOptions::new()
        .max_connections(5)
        .acquire_timeout(Duration::from_secs(3))
        .connect(database_url)
        .await
}

/// Check if the database connection is working
pub async fn check_db_connection(pool: &Pool<Postgres>) -> Result<(), sqlx::Error> {
    // Simple query to check if the connection is working
    sqlx::query("SELECT 1")
        .execute(pool)
        .await
        .map(|_| ())
}
