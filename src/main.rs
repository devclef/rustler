mod config;
mod db;
mod models;
mod routes;
mod services;

use std::net::SocketAddr;
use std::sync::Arc;

use axum::http::{header, Method, StatusCode, Uri};
use axum::response::{Html, IntoResponse, Response};
use axum::Router;
use axum::routing::get;
use std::path::PathBuf;
use tokio::fs;
use tokio::net::TcpListener;
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::ServeDir;
use tower_http::trace::TraceLayer;
use tracing::info;


// Handler for SPA fallback - serves index.html for all non-API routes
async fn spa_fallback_handler(uri: Uri) -> Response {
    // Skip API routes
    let path = uri.path();
    if path.starts_with("/api") {
        return (StatusCode::NOT_FOUND, "Not Found").into_response();
    }

    // Serve index.html for all other routes
    match fs::read_to_string("frontend/dist/index.html").await {
        Ok(html) => Html(html).into_response(),
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "Internal Server Error").into_response(),
    }
}

// Handler for the API root path
async fn api_root_handler() -> Html<String> {
    Html(format!(
        r#"<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Rustler API - Personal Finance</title>
    <style>
        body {{
            font-family: Arial, sans-serif;
            line-height: 1.6;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
        }}
        h1 {{
            color: #333;
            border-bottom: 1px solid #ddd;
            padding-bottom: 10px;
        }}
        h2 {{
            color: #444;
        }}
        ul {{
            padding-left: 20px;
        }}
        code {{
            background-color: #f4f4f4;
            padding: 2px 5px;
            border-radius: 3px;
        }}
    </style>
</head>
<body>
    <h1>Rustler API</h1>
    <p>A personal finance application built with Rust, providing a web-based interface for managing accounts and tracking financial transactions.</p>

    <h2>API Endpoints</h2>
    <ul>
        <li><code>GET /api/accounts</code> - List all accounts</li>
        <li><code>GET /api/accounts/{{id}}</code> - Get a specific account</li>
        <li><code>POST /api/accounts</code> - Create a new account</li>
        <li><code>PUT /api/accounts/{{id}}</code> - Update an account</li>
        <li><code>DELETE /api/accounts/{{id}}</code> - Delete an account</li>
        <li><code>GET /api/transactions</code> - List all transactions</li>
        <li><code>GET /api/accounts/{{id}}/transactions</code> - List transactions for a specific account</li>
        <li><code>GET /api/transactions/{{id}}</code> - Get a specific transaction</li>
        <li><code>POST /api/transactions</code> - Create a new transaction</li>
        <li><code>PUT /api/transactions/{{id}}</code> - Update a transaction</li>
        <li><code>DELETE /api/transactions/{{id}}</code> - Delete a transaction</li>
        <li><code>GET /api/budgets</code> - List all budgets</li>
        <li><code>GET /api/budgets/active</code> - List active budgets</li>
        <li><code>GET /api/budgets/monthly-status?year=YYYY&month=MM</code> - Get monthly budget status</li>
        <li><code>GET /api/budgets/{{id}}</code> - Get a specific budget</li>
        <li><code>POST /api/budgets</code> - Create a new budget</li>
        <li><code>PUT /api/budgets/{{id}}</code> - Update a budget</li>
        <li><code>DELETE /api/budgets/{{id}}</code> - Delete a budget</li>
        <li><code>GET /api/budgets/{{id}}/spent</code> - Get total spent amount for a budget</li>
        <li><code>GET /api/budgets/{{id}}/remaining</code> - Get remaining amount for a budget</li>
    </ul>

    <p><a href="/">Go to Web Interface</a></p>
</body>
</html>"#
    ))
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Initialize tracing
    tracing_subscriber::fmt::init();

    // Load configuration
    let config = config::Config::from_env().expect("Failed to load configuration");

    // Initialize database connection
    let db_pool = db::init_db_pool(&config.database_url).await?;

    // Run database migrations
    db::run_migrations(&db_pool).await?;

    // Run migration to fix NULL destination_account_id values
    db::fix_null_destination_accounts(&db_pool).await?;

    // Run migration to add destination_name column
    db::add_destination_name_column(&db_pool).await?;

    // Run migration to update account types from 'DESTINATION' to 'External'
    db::update_destination_account_type(&db_pool).await?;

    // Run migration to add settings table with forecasted_monthly_income
    db::add_settings_table(&db_pool).await?;

    // Run migration to add category groups functionality
    db::add_category_groups(&db_pool).await?;

    // Run migration to add budget groups functionality
    db::add_budget_groups_migration(&db_pool).await?;

    // Run migration to add rule groups functionality
    db::add_rule_groups(&db_pool).await?;

    // Run migration to add account_sub_type field and split account types
    db::add_account_sub_type(&db_pool).await?;

    // Run migration to add cleared_status tracking
    db::add_cleared_status(&db_pool).await?;

    // Check database connection
    db::check_db_connection(&db_pool).await?;

    // Create services
    let account_service = Arc::new(services::AccountService::new(db_pool.clone()));
    let transaction_service = Arc::new(services::TransactionService::new(db_pool.clone()));
    let category_service = Arc::new(services::CategoryService::new(db_pool.clone()));
    let category_group_service = Arc::new(services::CategoryGroupService::new(db_pool.clone()));
    let settings_service = Arc::new(services::SettingsService::new(db_pool.clone()));
    // Wire settings service into budget service so forecasted monthly income works on budget page
    let budget_service = Arc::new(services::BudgetService::new(db_pool.clone()).with_settings_service(settings_service.clone()));
    let budget_group_service = Arc::new(services::BudgetGroupService::new(db_pool.clone()));
    let rule_service = Arc::new(services::RuleService::new(db_pool.clone()));
    let rule_group_service = Arc::new(services::RuleGroupService::new(db_pool.clone()));
    let import_service = Arc::new(services::FireflyImportService::new(db_pool.clone()));

    // Create transaction rule service that combines transaction service and rule service
    let transaction_rule_service = Arc::new(services::TransactionRuleService::new(
        transaction_service.clone(),
        rule_service.clone()
    ));

    // Set up CORS
    let cors = CorsLayer::new()
        .allow_methods([Method::GET, Method::POST, Method::PUT, Method::DELETE])
        .allow_headers([header::CONTENT_TYPE])
        .allow_origin(Any);

    // Create API router
    let api_router = routes::create_router(
        account_service.clone(),
        transaction_service.clone(),
        transaction_rule_service.clone(),
        category_service.clone(),
        category_group_service.clone(),
        budget_service.clone(),
        budget_group_service.clone(),
        rule_service.clone(),
        rule_group_service.clone(),
        import_service.clone(),
        settings_service.clone(),
        config.firefly_import,
    );

    // Create main router with API routes and serve React frontend
    let app = Router::new()
        .route("/api", get(api_root_handler))
        .nest("/api", api_router)
        .nest_service("/assets", ServeDir::new("frontend/dist/assets"))
        // Serve icon files with correct MIME types
        .nest_service("/icons", ServeDir::new("frontend/dist/icons"))
        // Serve static files directly from the root of frontend/dist (manifest.json, sw.js, etc.)
        // Using ServeFile for specific files to ensure correct MIME types
        .route_service("/manifest.json", tower_http::services::ServeFile::new("frontend/dist/manifest.json"))
        .route_service("/sw.js", tower_http::services::ServeFile::new("frontend/dist/sw.js"))
        // Serve the root index.html
        .route_service("/", tower_http::services::ServeFile::new("frontend/dist/index.html"))
        // Use the spa_fallback_handler for client-side routing
        .fallback(spa_fallback_handler)
        .layer(TraceLayer::new_for_http())
        .layer(cors);

    // Start the server
    let addr = SocketAddr::new(
        config.host.parse().expect("Invalid host"),
        config.port,
    );

    info!("Starting server on {}", addr);

    // Create a TCP listener
    let listener = TcpListener::bind(addr).await?;

    // Run the server
    info!("Server started, listening on {}", addr);
    axum::serve(listener, app).await?;

    Ok(())
}
