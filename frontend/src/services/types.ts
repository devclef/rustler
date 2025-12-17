// Types for our data models
export interface CategoryGroup {
  id: string;
  name: string;
  description?: string;
  created_at: string;
  updated_at: string;
}

export interface RuleGroup {
  id: string;
  name: string;
  description?: string;
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: string;
  name: string;
  description?: string;
  group_id?: string;
  created_at: string;
  updated_at: string;
}

// String literal types for rule condition types
export type ConditionType =
  | 'description_contains'
  | 'description_starts_with'
  | 'description_equals'
  | 'source_account_equals'
  | 'destination_account_equals'
  | 'destination_name_contains'
  | 'destination_name_equals'
  | 'amount_greater_than'
  | 'amount_less_than'
  | 'amount_equals';

// Constant values for condition types (for reference)
export const ConditionTypes = {
  DescriptionContains: 'description_contains' as ConditionType,
  DescriptionStartsWith: 'description_starts_with' as ConditionType,
  DescriptionEquals: 'description_equals' as ConditionType,
  SourceAccountEquals: 'source_account_equals' as ConditionType,
  DestinationAccountEquals: 'destination_account_equals' as ConditionType,
  DestinationNameContains: 'destination_name_contains' as ConditionType,
  DestinationNameEquals: 'destination_name_equals' as ConditionType,
  AmountGreaterThan: 'amount_greater_than' as ConditionType,
  AmountLessThan: 'amount_less_than' as ConditionType,
  AmountEquals: 'amount_equals' as ConditionType,
};

// String literal types for rule action types
export type ActionType =
  | 'set_category'
  | 'set_budget'
  | 'set_description'
  | 'set_destination_name';

// Constant values for action types (for reference)
export const ActionTypes = {
  SetCategory: 'set_category' as ActionType,
  SetBudget: 'set_budget' as ActionType,
  SetDescription: 'set_description' as ActionType,
  SetDestinationName: 'set_destination_name' as ActionType,
};

// Represents a condition for a rule
export interface RuleCondition {
  condition_type: ConditionType;
  value: string;
}

// Represents an action for a rule
export interface RuleAction {
  action_type: ActionType;
  value: string;
}

// Represents a rule in the system
export interface Rule {
  id: string;
  name: string;
  description?: string;
  is_active: boolean;
  priority: number;
  group_id?: string;
  conditions: RuleCondition[];
  actions: RuleAction[];
  created_at: string;
  updated_at: string;
}

export interface Account {
  id: string;
  name: string;
  balance: number;
  account_type: string;
  account_sub_type?: string | null;
  currency: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface Transaction {
  id: string;
  source_account_id: string;
  destination_account_id?: string;
  payee_name?: string; // Keeping for backward compatibility
  destination_name?: string;
  description: string;
  amount: number;
  category: string;
  transaction_date: string;
  budget_id?: string;
  created_at: string;
  updated_at: string;
}

// Response for testing rule conditions
export interface RuleTestResponse {
  total_matches: number;
  sample: Transaction[];
}

export interface Budget {
  id: string;
  name: string;
  description?: string;
  amount: number;
  start_date: string;
  end_date?: string;
  group_id?: string;
  created_at: string;
  updated_at: string;
}

export interface MonthlyBudgetStatus {
  incoming_funds: number;
  budgeted_amount: number;
  remaining_to_budget: number;
  forecasted_monthly_income: number;
}

export interface CategorySpending {
  category: string;
  amount: number;
}

export type QuickAddFieldKey =
  | 'sourceAccount'
  | 'destinationAccount'
  | 'description'
  | 'amount'
  | 'category'
  | 'budget'
  | 'date';

export interface Settings {
  numberFormat: 'decimal' | 'comma';
  quickAddFields?: {
    sourceAccount: boolean;
    destinationAccount: boolean;
    description: boolean;
    amount: boolean;
    category: boolean;
    budget: boolean;
    date: boolean;
  };
  quickAddOrder?: QuickAddFieldKey[];
}

// Firefly III import options
export interface FireflyImportOptions {
  import_method: 'api' | 'csv';
  api_url?: string;
  api_token?: string;
  accounts_csv_path?: string;
  transactions_csv_path?: string;
}

// Firefly III import result
export interface ImportResult {
  accounts_imported: number;
  transactions_imported: number;
  errors: string[];
}

// Server-exposed feature flags
export interface Features {
  firefly_import: boolean;
}

// Forecasted monthly income response
export interface ForecastedMonthlyIncomeResponse {
  forecasted_monthly_income: number;
}

// Spending report row from /api/reports/spending
export interface SpendingReportRow {
  period: string; // e.g., '2025-01-01' (start of month/week/day label)
  name: string;   // category group name (or category name when group=false)
  amount: number; // total spending (positive outflows)
}

// Inflow vs Outflow report row from /api/reports/inflow-outflow
export interface InflowOutflowReportRow {
  period: string;
  inflow: number;
  outflow: number;
}

// Cleared status enum for transactions
export type ClearedStatus = 'uncleared' | 'cleared' | 'reconciled';

// Ledger transaction interface with computed fields for ledger view
export interface LedgerTransaction {
  id: string;
  date: string; // ISO date string from backend
  payee: string; // Computed from source/destination based on perspective
  category: string;
  cleared_status: ClearedStatus;
  outflow: number | null; // Shown when money leaves account
  inflow: number | null; // Shown when money enters account
  memo: string;
  is_transfer: boolean;
  running_balance?: number; // Computed on frontend, not from API
}

// Response from the ledger API endpoint
export interface LedgerResponse {
  transactions: LedgerTransaction[];
  total_count: number;
  current_balance: number;
  cleared_balance: number;
}
