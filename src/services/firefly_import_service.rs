use std::collections::HashMap;
use std::path::Path;
use std::fs::File;
use std::io::{BufReader, Read};
use std::str::FromStr;
use chrono::{DateTime, Utc};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use sqlx::{Pool, Postgres};
use uuid::Uuid;
use csv::ReaderBuilder;
use tracing::{debug, info, log};
use crate::models::{Account, CreateAccountRequest, Transaction, CreateTransactionRequest, ClearedStatus, firefly_import::{FireflyImportOptions, ImportResult, AccountTypeMapping, FailedTransactionDetails}};
use crate::services::account_service::AccountService;
use crate::services::transaction_service::TransactionService;

// Firefly III account types
#[derive(Debug, Deserialize, Serialize, Clone)]
pub enum FireflyAccountType {
    #[serde(rename = "Asset account")]
    Asset,
    #[serde(rename = "expense")]
    Expense,
    #[serde(rename = "revenue")]
    Revenue,
    #[serde(rename = "loan")]
    Loan,
    #[serde(rename = "debt")]
    Debt,
    #[serde(rename = "liabilities")]
    Liabilities,
    #[serde(other)]
    Other,
}

// Firefly III transaction types
#[derive(Debug, Deserialize, Serialize, Clone)]
pub enum FireflyTransactionType {
    #[serde(rename = "withdrawal")]
    Withdrawal,
    #[serde(rename = "deposit")]
    Deposit,
    #[serde(rename = "transfer")]
    Transfer,
    #[serde(other)]
    Other,
}

// Firefly III account model
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct FireflyAccount {
    pub id: String,
    pub name: String,
    pub type_: FireflyAccountType,
    pub currency_code: String,
    pub current_balance: Option<f64>,
    pub notes: Option<String>,
}

// Firefly III transaction model
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct FireflyTransaction {
    pub id: String,
    pub transaction_type: FireflyTransactionType,
    pub description: String,
    pub date: DateTime<Utc>,
    pub amount: f64,
    pub source_id: String,
    pub source_name: String,
    pub destination_id: String,
    pub destination_name: String,
    pub category_name: Option<String>,
    pub notes: Option<String>,
}

// Firefly III API response structure for accounts
#[derive(Debug, Deserialize)]
struct FireflyAccountsResponse {
    data: Vec<FireflyApiAccount>,
    meta: Option<serde_json::Value>,
    links: Option<serde_json::Value>,
}

// Firefly III API account structure
#[derive(Debug, Deserialize)]
struct FireflyApiAccount {
    #[serde(rename = "type")]
    type_: String,
    id: String,
    attributes: FireflyApiAccountAttributes,
    links: Option<serde_json::Value>,
}

// Firefly III API account attributes
#[derive(Debug, Deserialize)]
struct FireflyApiAccountAttributes {
    created_at: String,
    updated_at: String,
    name: String,
    #[serde(rename = "type")]
    type_: String,
    account_role: Option<String>,
    currency_id: String,
    currency_code: String,
    currency_symbol: String,
    currency_decimal_places: i32,
    current_balance: Option<String>,
    notes: Option<String>,
    // Add other fields as needed, or use a catch-all for unknown fields
    #[serde(flatten)]
    extra: HashMap<String, serde_json::Value>,
}

// Firefly III API response structure for transactions
#[derive(Debug, Deserialize)]
struct FireflyTransactionsResponse {
    data: Vec<FireflyApiTransaction>,
    meta: Option<serde_json::Value>,
    links: Option<serde_json::Value>,
}

// Firefly III API transaction structure
#[derive(Debug, Deserialize)]
struct FireflyApiTransaction {
    #[serde(rename = "type")]
    type_: String,
    id: String,
    attributes: FireflyApiTransactionAttributes,
    links: Option<serde_json::Value>,
}

// Firefly III API transaction attributes
#[derive(Debug, Deserialize)]
struct FireflyApiTransactionAttributes {
    created_at: String,
    updated_at: String,
    description: String,
    date: String,
    transactions: Vec<FireflyApiTransactionSplit>,
    // Add other fields as needed, or use a catch-all for unknown fields
    #[serde(flatten)]
    extra: HashMap<String, serde_json::Value>,
}

// Firefly III API transaction split
#[derive(Debug, Deserialize)]
struct FireflyApiTransactionSplit {
    amount: String,
    description: String,
    source_id: Option<String>,
    source_name: Option<String>,
    destination_id: Option<String>,
    destination_name: Option<String>,
    category_name: Option<String>,
    #[serde(rename = "type")]
    transaction_type: String,
    date: String,
    // Add other fields as needed, or use a catch-all for unknown fields
    #[serde(flatten)]
    extra: HashMap<String, serde_json::Value>,
}

// CSV row for Firefly III account export
#[derive(Debug, Deserialize, Clone)]
pub struct FireflyAccountCsv {
    pub user_id: Option<String>,
    #[serde(rename = "account_id")]
    pub id: String,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    #[serde(rename = "type")]
    pub type_: String,
    pub name: String,
    pub virtual_balance: Option<String>,
    pub iban: Option<String>,
    pub number: Option<String>,
    pub active: Option<String>,
    pub currency_code: String,
    pub role: Option<String>,
    pub cc_type: Option<String>,
    pub cc_payment_date: Option<String>,
    pub in_net_worth: Option<String>,
    pub interest: Option<String>,
    pub interest_period: Option<String>,
    pub current_balance: Option<String>,
    pub notes: Option<String>,
}

// CSV row for Firefly III transaction export
#[derive(Debug, Deserialize, Clone)]
pub struct FireflyTransactionCsv {
    pub user_id: Option<String>,
    pub group_id: Option<String>,
    #[serde(rename = "journal_id")]
    pub id: String,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub group_title: Option<String>,
    #[serde(rename = "type")]
    pub transaction_type: String,
    pub currency_code: Option<String>,
    pub amount: String,
    pub foreign_currency_code: Option<String>,
    pub foreign_amount: Option<String>,
    pub native_currency_code: Option<String>,
    pub native_amount: Option<String>,
    pub native_foreign_amount: Option<String>,
    pub description: String,
    pub date: String,
    pub source_name: String,
    pub source_iban: Option<String>,
    pub source_type: Option<String>,
    pub destination_name: String,
    pub destination_iban: Option<String>,
    pub destination_type: Option<String>,
    pub reconciled: Option<String>,
    #[serde(rename = "category")]
    pub category_name: Option<String>,
    pub budget: Option<String>,
    pub bill: Option<String>,
    pub tags: Option<String>,
    pub notes: Option<String>,
    pub sepa_cc: Option<String>,
    pub sepa_ct_op: Option<String>,
    pub sepa_ct_id: Option<String>,
    pub sepa_db: Option<String>,
    pub sepa_country: Option<String>,
    pub sepa_ep: Option<String>,
    pub sepa_ci: Option<String>,
    pub sepa_batch_id: Option<String>,
    pub external_url: Option<String>,
    pub interest_date: Option<String>,
    pub book_date: Option<String>,
    pub process_date: Option<String>,
    pub due_date: Option<String>,
    pub payment_date: Option<String>,
    pub invoice_date: Option<String>,
    pub recurrence_id: Option<String>,
    pub internal_reference: Option<String>,
    pub bunq_payment_id: Option<String>,
    pub import_hash: Option<String>,
    pub import_hash_v2: Option<String>,
    pub external_id: Option<String>,
    pub original_source: Option<String>,
    pub recurrence_total: Option<String>,
    pub recurrence_count: Option<String>,
    pub recurrence_date: Option<String>,
}


// Service for importing data from Firefly III
pub struct FireflyImportService {
    db: Pool<Postgres>,
    account_service: AccountService,
    transaction_service: TransactionService,
}

impl FireflyImportService {
    // Create a new FireflyImportService
    pub fn new(db: Pool<Postgres>) -> Self {
        Self {
            db: db.clone(),
            account_service: AccountService::new(db.clone()),
            transaction_service: TransactionService::new(db),
        }
    }

    // Map Firefly III account type to Rustler account type
    fn map_account_type(&self, firefly_type: &str) -> String {
        match firefly_type.to_lowercase().as_str() {
            "asset" => {
                if firefly_type.to_lowercase().contains("checking") {
                    "On Budget".to_string()
                } else if firefly_type.to_lowercase().contains("savings") {
                    "On Budget".to_string()
                } else if firefly_type.to_lowercase().contains("credit card") {
                    "On Budget".to_string()
                } else if firefly_type.to_lowercase().contains("investment") {
                    "On Budget".to_string()
                } else {
                    "Off Budget".to_string()
                }
            }
            "loan" | "debt" | "liabilities" => "Off Budget".to_string(),
            "expense" | "revenue" => "External".to_string(),
            _ => "External".to_string(),
        }
    }

    // Import accounts and transactions from Firefly III
    pub async fn import(&self, options: FireflyImportOptions) -> Result<ImportResult, String> {
        let mut result = ImportResult {
            accounts_imported: 0,
            transactions_imported: 0,
            errors: Vec::new(),
            failed_transactions: Vec::new(),
        };

        // Import accounts and transactions based on the selected method
        match options.import_method.as_str() {
            "api" => {
                if let (Some(api_url), Some(api_token)) = (&options.api_url, &options.api_token) {
                    self.import_from_api(api_url, api_token, &options.account_type_mapping, &mut result).await?;
                } else {
                    return Err("API URL and token are required for API import".to_string());
                }
            }
            "csv" => {
                if let (Some(accounts_csv), Some(transactions_csv)) = (&options.accounts_csv_path, &options.transactions_csv_path) {
                    self.import_from_csv(accounts_csv, transactions_csv, &options.account_type_mapping, &mut result).await?;
                } else {
                    return Err("Accounts and transactions CSV paths are required for CSV import".to_string());
                }
            }
            _ => {
                return Err("Invalid import method. Use 'api' or 'csv'".to_string());
            }
        }

        Ok(result)
    }

    // Import accounts and transactions from Firefly III API
    async fn import_from_api(&self, api_url: &str, api_token: &str, account_type_mapping: &AccountTypeMapping, result: &mut ImportResult) -> Result<(), String> {
        // Create HTTP client
        let client = Client::new();

        // Fetch accounts from Firefly III API
        let accounts = self.fetch_accounts_from_api(&client, api_url, api_token).await?;

        // Map of Firefly III account IDs to Rustler account IDs
        let account_id_map = self.import_accounts(accounts, account_type_mapping, result).await?;

        // Fetch transactions from Firefly III API
        let transactions = self.fetch_transactions_from_api(&client, api_url, api_token).await?;

        // Import transactions
        self.import_transactions(transactions, &account_id_map, result).await?;

        Ok(())
    }

    // Fetch accounts from Firefly III API
    async fn fetch_accounts_from_api(&self, client: &Client, api_url: &str, api_token: &str) -> Result<Vec<FireflyAccount>, String> {
        // Build the API URL for accounts
        let accounts_url = format!("{}/api/v1/accounts", api_url.trim_end_matches('/'));

        // Make the API request
        let response = client.get(&accounts_url)
            .header("Authorization", format!("Bearer {}", api_token))
            .header("Accept", "application/json")
            .send()
            .await
            .map_err(|e| format!("Failed to fetch accounts from API: {}", e))?;

        // Check if the request was successful
        if !response.status().is_success() {
            return Err(format!("Failed to fetch accounts: HTTP {}", response.status()));
        }

        // Get the response body as text first
        let response_text = response.text().await
            .map_err(|e| format!("Failed to get response text: {}", e))?;

        // Try different parsing approaches

        // 1. Try to parse as a structured response with data field
        let structured_result = serde_json::from_str::<FireflyAccountsResponse>(&response_text);
        if let Ok(accounts_response) = structured_result {
            // Convert FireflyApiAccount objects to FireflyAccount objects
            let mut accounts = Vec::new();
            for api_account in accounts_response.data {
                // Map the account type
                let account_type = match api_account.attributes.type_.as_str() {
                    "asset" => FireflyAccountType::Asset,
                    "expense" => FireflyAccountType::Expense,
                    "revenue" => FireflyAccountType::Revenue,
                    "loan" => FireflyAccountType::Loan,
                    "debt" => FireflyAccountType::Debt,
                    "liabilities" => FireflyAccountType::Liabilities,
                    _ => FireflyAccountType::Other,
                };

                // Parse current balance
                let current_balance = api_account.attributes.current_balance
                    .and_then(|b| b.parse::<f64>().ok());

                // Create FireflyAccount from FireflyApiAccount
                let account = FireflyAccount {
                    id: api_account.id,
                    name: api_account.attributes.name,
                    type_: account_type,
                    currency_code: api_account.attributes.currency_code,
                    current_balance,
                    notes: api_account.attributes.notes,
                };

                accounts.push(account);
            }

            return Ok(accounts);
        }

        // 2. Try to parse as a direct array of accounts
        let array_result = serde_json::from_str::<Vec<FireflyAccount>>(&response_text);
        if let Ok(accounts) = array_result {
            return Ok(accounts);
        }

        // 3. Try to parse as a JSON object that might contain accounts in a different format
        let json_result = serde_json::from_str::<serde_json::Value>(&response_text);
        if let Ok(json) = json_result {
            // If it's an object with a "data" field that's an array
            if let Some(data) = json.get("data") {
                if let Ok(accounts) = serde_json::from_value::<Vec<FireflyAccount>>(data.clone()) {
                    return Ok(accounts);
                }
            }

            // If it's an object with accounts as direct properties
            if json.is_object() {
                let mut accounts = Vec::new();
                for (_, value) in json.as_object().unwrap() {
                    if let Ok(account) = serde_json::from_value::<FireflyAccount>(value.clone()) {
                        accounts.push(account);
                    }
                }
                if !accounts.is_empty() {
                    return Ok(accounts);
                }
            }
        }

        // If all parsing attempts fail, return an error with details
        Err(format!("Failed to parse accounts response in any format: {}", response_text))
    }

    // Fetch transactions from Firefly III API
    async fn fetch_transactions_from_api(&self, client: &Client, api_url: &str, api_token: &str) -> Result<Vec<FireflyTransaction>, String> {
        // Build the API URL for transactions
        let transactions_url = format!("{}/api/v1/transactions", api_url.trim_end_matches('/'));

        // Make the API request
        let response = client.get(&transactions_url)
            .header("Authorization", format!("Bearer {}", api_token))
            .header("Accept", "application/json")
            .send()
            .await
            .map_err(|e| format!("Failed to fetch transactions from API: {}", e))?;

        // Check if the request was successful
        if !response.status().is_success() {
            return Err(format!("Failed to fetch transactions: HTTP {}", response.status()));
        }

        // Get the response body as text first
        let response_text = response.text().await
            .map_err(|e| format!("Failed to get response text: {}", e))?;

        // Try different parsing approaches

        // 1. Try to parse as a structured response with data field
        let structured_result = serde_json::from_str::<FireflyTransactionsResponse>(&response_text);
        if let Ok(transactions_response) = structured_result {
            // Convert FireflyApiTransaction objects to FireflyTransaction objects
            let mut transactions = Vec::new();
            for api_transaction in transactions_response.data {
                // Process each transaction group
                for split in api_transaction.attributes.transactions {
                    // Map the transaction type
                    let transaction_type = match split.transaction_type.to_lowercase().as_str() {
                        "withdrawal" => FireflyTransactionType::Withdrawal,
                        "deposit" => FireflyTransactionType::Deposit,
                        "transfer" => FireflyTransactionType::Transfer,
                        _ => FireflyTransactionType::Other,
                    };

                    // Parse amount
                    let amount = split.amount.parse::<f64>()
                        .map_err(|_| format!("Failed to parse transaction amount: {}", split.amount))?;

                    // Parse date
                    let date = DateTime::parse_from_rfc3339(&split.date)
                        .or_else(|_| DateTime::parse_from_str(&split.date, "%Y-%m-%d %H:%M:%S"))
                        .map_err(|e| format!("Failed to parse transaction date: {}", e))?
                        .with_timezone(&Utc);

                    // Create FireflyTransaction from FireflyApiTransaction
                    let transaction = FireflyTransaction {
                        id: api_transaction.id.clone(),
                        transaction_type,
                        description: split.description.clone(),
                        date,
                        amount,
                        source_id: split.source_id.clone().unwrap_or_default(),
                        source_name: split.source_name.clone().unwrap_or_default(),
                        destination_id: split.destination_id.clone().unwrap_or_default(),
                        destination_name: split.destination_name.clone().unwrap_or_default(),
                        category_name: split.category_name.clone(),
                        notes: None, // API doesn't provide notes in this format
                    };

                    transactions.push(transaction);
                }
            }

            return Ok(transactions);
        }

        // 2. Try to parse as a direct array of transactions
        let array_result = serde_json::from_str::<Vec<FireflyTransaction>>(&response_text);
        if let Ok(transactions) = array_result {
            return Ok(transactions);
        }

        // 3. Try to parse as a JSON object that might contain transactions in a different format
        let json_result = serde_json::from_str::<serde_json::Value>(&response_text);
        if let Ok(json) = json_result {
            // If it's an object with a "data" field that's an array
            if let Some(data) = json.get("data") {
                if let Ok(transactions) = serde_json::from_value::<Vec<FireflyTransaction>>(data.clone()) {
                    return Ok(transactions);
                }
            }

            // If it's an object with transactions as direct properties
            if json.is_object() {
                let mut transactions = Vec::new();
                for (_, value) in json.as_object().unwrap() {
                    if let Ok(transaction) = serde_json::from_value::<FireflyTransaction>(value.clone()) {
                        transactions.push(transaction);
                    }
                }
                if !transactions.is_empty() {
                    return Ok(transactions);
                }
            }
        }

        // If all parsing attempts fail, return an error with details
        Err(format!("Failed to parse transactions response in any format: {}", response_text))
    }

    // Import accounts and transactions from CSV files
    async fn import_from_csv(&self, accounts_csv_path: &str, transactions_csv_path: &str, account_type_mapping: &AccountTypeMapping, result: &mut ImportResult) -> Result<(), String> {
        // Read accounts from CSV
        let accounts = self.read_accounts_from_csv(accounts_csv_path)?;

        // Map of Firefly III account IDs to Rustler account IDs
        let account_id_map = self.import_accounts(accounts, account_type_mapping, result).await?;

        // Read transactions from CSV
        let transactions = self.read_transactions_from_csv(transactions_csv_path)?;

        // Import transactions
        self.import_transactions(transactions, &account_id_map, result).await?;

        Ok(())
    }

    // Read accounts from CSV file
    fn read_accounts_from_csv(&self, csv_path: &str) -> Result<Vec<FireflyAccount>, String> {
        // Open the CSV file
        info!("Reading accounts from {}", csv_path);
        let file = File::open(csv_path)
            .map_err(|e| format!("Failed to open accounts CSV file: {}", e))?;

        let reader = BufReader::new(file);

        // Create CSV reader
        let mut csv_reader = ReaderBuilder::new()
            .has_headers(true)
            .delimiter(b',')
            .from_reader(reader);

        // Read accounts from CSV
        let mut accounts = Vec::new();
        for result in csv_reader.deserialize::<FireflyAccountCsv>() {
            match result {
                Ok(csv_account) => {
                    // Convert CSV account to FireflyAccount
                    let account_type = match csv_account.type_.to_lowercase().as_str() {
                        "asset account" => FireflyAccountType::Asset,
                        "expense account" => FireflyAccountType::Expense,
                        "revenue account" => FireflyAccountType::Revenue,
                        "loan" => FireflyAccountType::Loan,
                        "debt" => FireflyAccountType::Debt,
                        "mortgage" => FireflyAccountType::Liabilities,
                        "liabilities" => FireflyAccountType::Liabilities,
                        _ => FireflyAccountType::Other,
                    };
                    info!("Account type: {:?} for {}", account_type, csv_account.name);
                    //raw csv data
                    info!("Account: {:?}", csv_account);
                    let current_balance = csv_account.current_balance
                        .and_then(|b| b.parse::<f64>().ok());

                    accounts.push(FireflyAccount {
                        id: csv_account.id,
                        name: csv_account.name,
                        type_: account_type,
                        currency_code: csv_account.currency_code,
                        current_balance,
                        notes: csv_account.notes,
                    });
                }
                Err(e) => {
                    return Err(format!("Failed to parse account from CSV: {}", e));
                }
            }
        }

        Ok(accounts)
    }

    // Read transactions from CSV file
    fn read_transactions_from_csv(&self, csv_path: &str) -> Result<Vec<FireflyTransaction>, String> {
        // Open the CSV file
        debug!("Reading transactions from {}", csv_path);
        let file = File::open(csv_path)
            .map_err(|e| format!("Failed to open transactions CSV file: {}", e))?;

        let reader = BufReader::new(file);

        // Create CSV reader with flexible option to handle records with different numbers of fields
        let mut csv_reader = ReaderBuilder::new()
            .has_headers(true)
            .delimiter(b',')
            .flexible(true)
            .from_reader(reader);

        // Read transactions from CSV
        let mut transactions = Vec::new();
        for result in csv_reader.deserialize::<FireflyTransactionCsv>() {
            match result {
                Ok(csv_transaction) => {
                    // Convert CSV transaction to FireflyTransaction
                    let transaction_type = match csv_transaction.transaction_type.to_lowercase().as_str() {
                        "withdrawal" => FireflyTransactionType::Withdrawal,
                        "deposit" => FireflyTransactionType::Deposit,
                        "transfer" => FireflyTransactionType::Transfer,
                        _ => FireflyTransactionType::Other,
                    };

                    // Parse date
                    let date = DateTime::parse_from_rfc3339(&csv_transaction.date)
                        .map_err(|e| format!("Failed to parse transaction date: {}", e))?
                        .with_timezone(&Utc);

                    // Parse amount
                    let amount = csv_transaction.amount.parse::<f64>()
                        .map_err(|e| format!("Failed to parse transaction amount: {}", e))?;

                    // Generate source_id and destination_id from source_name and destination_name
                    // This is a simplification; in a real-world scenario, you might want to look up
                    // the actual account IDs from a database or use a more sophisticated mapping
                    let source_id = format!("source-{}", csv_transaction.id);
                    let destination_id = format!("dest-{}", csv_transaction.id);

                    transactions.push(FireflyTransaction {
                        id: csv_transaction.id,
                        transaction_type,
                        description: csv_transaction.description,
                        date,
                        amount,
                        source_id,
                        source_name: csv_transaction.source_name,
                        destination_id,
                        destination_name: csv_transaction.destination_name,
                        category_name: csv_transaction.category_name,
                        notes: csv_transaction.notes,
                    });
                }
                Err(e) => {
                    return Err(format!("Failed to parse transaction from CSV: {}", e));
                }
            }
        }

        Ok(transactions)
    }

    // Import accounts from Firefly III to Rustler
    async fn import_accounts(&self, accounts: Vec<FireflyAccount>, account_type_mapping: &AccountTypeMapping, result: &mut ImportResult) -> Result<HashMap<String, Uuid>, String> {
        debug!("Importing {} accounts", accounts.len());
        let mut account_id_map = HashMap::new();

        // Get existing accounts to avoid duplicates
        let existing_accounts = self.account_service.get_accounts()
            .await
            .map_err(|e| format!("Failed to fetch existing accounts: {}", e))?;

        // Create a map of account names to IDs for quick lookup
        let mut existing_account_names = HashMap::new();
        for account in &existing_accounts {
            existing_account_names.insert(account.name.clone(), account.id);
        }

        // Import each account
        for firefly_account in accounts {
            debug!("Processing account: {}", firefly_account.name);
            //account type from firefly
            debug!("Account type: {:?}", firefly_account.type_);
            //Entire account from firefly
            debug!("Account: {:?}", firefly_account);
            // Skip if account already exists
            if let Some(existing_id) = existing_account_names.get(&firefly_account.name) {
                debug!("Account {} already exists with ID {}", firefly_account.name, existing_id);
                account_id_map.insert(firefly_account.id, *existing_id);
                continue;
            }

            // Check if there's a specific mapping for this account by name
            let account_type = if let Some(specific_type) = account_type_mapping.account_specific.get(&firefly_account.name) {
                debug!("Using specific account type mapping for {}: {}", firefly_account.name, specific_type);
                specific_type.clone()
            } else {
                // Use the general type mapping based on the account type
                let mapped_type = match firefly_account.type_ {
                    FireflyAccountType::Asset => account_type_mapping.asset.clone(),
                    FireflyAccountType::Expense => account_type_mapping.expense.clone(),
                    FireflyAccountType::Revenue => account_type_mapping.revenue.clone(),
                    FireflyAccountType::Loan => account_type_mapping.loan.clone(),
                    FireflyAccountType::Debt => account_type_mapping.debt.clone(),
                    FireflyAccountType::Liabilities => account_type_mapping.liabilities.clone(),
                    FireflyAccountType::Other => account_type_mapping.other.clone(),
                };
                debug!("Using general account type mapping for {}: {:?} -> {}", firefly_account.name, firefly_account.type_, mapped_type);
                mapped_type
            };

            // Create account request
            let create_request = CreateAccountRequest {
                name: firefly_account.name.clone(),
                account_type: account_type.to_string(),
                account_sub_type: None, // No specific subtype for imported accounts
                balance: firefly_account.current_balance.unwrap_or(0.0),
                cleared_balance: 0.0,
                currency: firefly_account.currency_code.clone(),
                is_default: false, // Imported accounts are not default by default
            };

            // Create the account
            match self.account_service.create_account(create_request).await {
                Ok(account) => {
                    debug!("Created account {} with ID {}", firefly_account.name, account.id);
                    account_id_map.insert(firefly_account.id, account.id);
                    result.accounts_imported += 1;
                }
                Err(e) => {
                    log::error!("Failed to create account {}: {}", firefly_account.name, e);
                    result.errors.push(format!("Failed to create account {}: {}", firefly_account.name, e));
                }
            }
        }

        debug!("Imported {} accounts successfully", result.accounts_imported);
        Ok(account_id_map)
    }
    // Import transactions from Firefly III to Rustler
    async fn import_transactions(&self, transactions: Vec<FireflyTransaction>, account_id_map: &HashMap<String, Uuid>, result: &mut ImportResult) -> Result<(), String> {
        // Get existing accounts to find accounts by name if they're not in the map
        let existing_accounts = self.account_service.get_accounts()
            .await
            .map_err(|e| format!("Failed to fetch existing accounts: {}", e))?;

        // Create a map of account names to IDs for quick lookup
        let mut existing_account_names = HashMap::new();
        for account in &existing_accounts {
            existing_account_names.insert(account.name.clone(), account.id);
        }

        // Import each transaction
        for firefly_transaction in transactions {
            // Try to find the source account by ID in the map first
            let source_account_id = if let Some(id) = account_id_map.get(&firefly_transaction.source_id) {
                *id
            } else {
                // If not found by ID, try to find by name in existing accounts
                if let Some(id) = existing_account_names.get(&firefly_transaction.source_name) {
                    *id
                } else {
                    // If still not found, create a new account with this name
                    let now = chrono::Utc::now();
                    let create_request = CreateAccountRequest {
                        name: firefly_transaction.source_name.clone(),
                        account_type: "On Budget".to_string(), // Default to On Budget for new accounts
                        account_sub_type: None, // No specific subtype for automatically created accounts
                        balance: 0.0, // Start with zero balance
                        cleared_balance: 0.0,
                        currency: "USD".to_string(), // Default currency
                        is_default: false,
                    };

                    match self.account_service.create_account(create_request).await {
                        Ok(account) => {
                            // Add the new account to our maps for future lookups
                            existing_account_names.insert(firefly_transaction.source_name.clone(), account.id);
                            account.id
                        }
                        Err(e) => {
                            result.errors.push(format!(
                                "Skipping transaction {}: Failed to create source account {}: {}",
                                firefly_transaction.id, firefly_transaction.source_name, e
                            ));
                            continue;
                        }
                    }
                }
            };

            // Get destination account ID if it exists in the map
            let destination_account_id = if let Some(id) = account_id_map.get(&firefly_transaction.destination_id) {
                Some(*id)
            } else if let Some(id) = existing_account_names.get(&firefly_transaction.destination_name) {
                // If not found by ID, try to find by name in existing accounts
                Some(*id)
            } else {
                // For destination, we'll let the transaction service handle creating it if needed
                None
            };

            // Determine transaction amount based on transaction type
            let amount = match firefly_transaction.transaction_type {
                FireflyTransactionType::Withdrawal => -firefly_transaction.amount,
                FireflyTransactionType::Deposit => firefly_transaction.amount, // Keep deposits positive to match Rustler's withdrawal convention
                FireflyTransactionType::Transfer => firefly_transaction.amount,
                _ => -firefly_transaction.amount,
            };

            // Determine category
            let category = firefly_transaction.category_name.unwrap_or_else(|| {
                match firefly_transaction.transaction_type {
                    FireflyTransactionType::Withdrawal => "Expense".to_string(),
                    FireflyTransactionType::Deposit => "Income".to_string(),
                    FireflyTransactionType::Transfer => "Transfer".to_string(),
                    _ => "Other".to_string(),
                }
            });

            // Create transaction request
            let create_request = CreateTransactionRequest {
                source_account_id,
                destination_account_id,
                destination_name: Some(firefly_transaction.destination_name.clone()),
                description: firefly_transaction.description.clone(),
                amount,
                category,
                budget_id: None, // Firefly III doesn't have direct budget mapping
                transaction_date: Some(firefly_transaction.date),
                cleared_status: ClearedStatus::Uncleared,
            };
            info!("Transaction type: {:?}", firefly_transaction.transaction_type);
            info!("Creating transaction: {:?}", create_request);

            // Create the transaction
            match self.transaction_service.create_transaction(create_request.clone()).await {
                Ok(_) => {
                    result.transactions_imported += 1;
                }
                Err(e) => {
                    let error_message = format!(
                        "Failed to create transaction {}: {}",
                        firefly_transaction.description, e
                    );
                    result.errors.push(error_message.clone());

                    // Store the failed transaction details for retry
                    let failed_transaction = FailedTransactionDetails {
                        source_account_id: create_request.source_account_id,
                        destination_account_id: create_request.destination_account_id,
                        destination_name: create_request.destination_name,
                        description: create_request.description,
                        amount: create_request.amount,
                        category: create_request.category,
                        budget_id: create_request.budget_id,
                        transaction_date: create_request.transaction_date,
                        error_message,
                    };
                    result.failed_transactions.push(failed_transaction);
                }
            }
        }

        Ok(())
    }
}
