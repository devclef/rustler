mod accounts;
mod transactions;
mod categories;
mod category_groups;
mod budgets;
mod budget_groups;
mod web;
mod category_spending;
mod reports;
mod rules;
mod rule_groups;
mod imports;
mod settings;
mod payees;

use axum::{
    Router,
    routing::{get, post, put, delete},
};

mod features;

pub fn create_router(
    account_service: Arc<AccountService>,
    transaction_service: Arc<TransactionService>,
    transaction_rule_service: Arc<TransactionRuleService>,
    category_service: Arc<CategoryService>,
    category_group_service: Arc<CategoryGroupService>,
    budget_service: Arc<BudgetService>,
    budget_group_service: Arc<BudgetGroupService>,
    rule_service: Arc<RuleService>,
    rule_group_service: Arc<RuleGroupService>,
    import_service: Arc<FireflyImportService>,
    settings_service: Arc<SettingsService>,
    firefly_import_enabled: bool,
) -> Router {
    let mut router = Router::new()
        .merge(accounts::router(account_service.clone(), transaction_service.clone()))
        .merge(transactions::router(transaction_rule_service.clone()))
        .merge(categories::router(category_service))
        .merge(category_groups::router(category_group_service))
        .merge(budgets::router(budget_service))
        .merge(budget_groups::router(budget_group_service))
        .merge(category_spending::router(transaction_service.clone()))
        .merge(reports::router(transaction_service.clone()))
        .merge(rules::router(rule_service))
        .merge(rule_groups::router(rule_group_service))
        .merge(settings::router(settings_service))
        .merge(features::router(firefly_import_enabled))
        .merge(payees::router(account_service, transaction_service.clone()));

    if firefly_import_enabled {
        router = router.merge(imports::router(import_service));
    }

    router
}

pub use web::router as web_router_impl;

use std::sync::Arc;
use crate::services::{AccountService, TransactionService, TransactionRuleService, CategoryService, CategoryGroupService, BudgetService, BudgetGroupService, RuleService, RuleGroupService, FireflyImportService, SettingsService};

pub fn web_router(
    account_service: Arc<AccountService>,
    transaction_service: Arc<TransactionService>,
    transaction_rule_service: Arc<TransactionRuleService>,
    category_service: Arc<CategoryService>,
    budget_service: Arc<BudgetService>,
    rule_service: Arc<RuleService>
) -> Router {
    web_router_impl(account_service, transaction_service, transaction_rule_service, category_service, budget_service, rule_service)
}
