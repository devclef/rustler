// API base URL
const API_BASE_URL = '/api';

// Import types from types.ts
import type {
  Account,
  Category,
  CategoryGroup,
  Transaction,
  Budget,
  MonthlyBudgetStatus,
  CategorySpending,
  Rule,
  RuleCondition,
  RuleAction,
  ConditionType,
  ActionType,
  FireflyImportOptions,
  ImportResult,
  ForecastedMonthlyIncomeResponse,
  SpendingReportRow,
  InflowOutflowReportRow,
  Features,
  RuleTestResponse,
  RuleGroup,
  ClearedStatus,
  LedgerTransaction,
  LedgerResponse
} from './types.ts';

// Re-export types for convenience
export type {
  Account,
  Category,
  CategoryGroup,
  RuleGroup,
  Transaction,
  Budget,
  MonthlyBudgetStatus,
  CategorySpending,
  Rule,
  RuleCondition,
  RuleAction,
  ConditionType,
  ActionType,
  FireflyImportOptions,
  ImportResult,
  ForecastedMonthlyIncomeResponse,
  SpendingReportRow,
  InflowOutflowReportRow,
  RuleTestResponse,
  ClearedStatus,
  LedgerTransaction,
  LedgerResponse
};

// Reports API
export const reportsApi = {
  // Get spending over time (grouped by category group or category)
  getSpending: async (params: {
    start_date?: string;
    end_date?: string;
    account_ids?: string[]; // array of UUID strings
    group?: boolean; // default true on backend
    period?: 'day' | 'week' | 'month';
  }): Promise<SpendingReportRow[]> => {
    const query = new URLSearchParams();
    if (params.start_date) query.set('start_date', params.start_date);
    if (params.end_date) query.set('end_date', params.end_date);
    if (params.account_ids && params.account_ids.length > 0) {
      query.set('account_ids', params.account_ids.join(','));
    }
    if (typeof params.group === 'boolean') query.set('group', String(params.group));
    if (params.period) query.set('period', params.period);
    // cache-buster to avoid caching in dev
    query.set('_t', String(Date.now()));

    const res = await fetch(`${API_BASE_URL}/reports/spending?${query.toString()}`);
    if (!res.ok) {
      throw new Error('Failed to fetch spending report');
    }
    return res.json();
  },

  // Get inflow vs outflow over time
  getInflowOutflow: async (params: {
    start_date?: string;
    end_date?: string;
    account_ids?: string[];
    period?: 'day' | 'week' | 'month';
  }): Promise<InflowOutflowReportRow[]> => {
    const query = new URLSearchParams();
    if (params.start_date) query.set('start_date', params.start_date);
    if (params.end_date) query.set('end_date', params.end_date);
    if (params.account_ids && params.account_ids.length > 0) {
      query.set('account_ids', params.account_ids.join(','));
    }
    if (params.period) query.set('period', params.period);
    query.set('_t', String(Date.now()));

    const res = await fetch(`${API_BASE_URL}/reports/inflow-outflow?${query.toString()}`);
    if (!res.ok) {
      throw new Error('Failed to fetch inflow/outflow report');
    }
    return res.json();
  },
};

// API functions for accounts
export const accountsApi = {
  // Get all accounts
  getAccounts: async (): Promise<Account[]> => {
    // Add a cache-busting parameter to prevent browser caching
    const cacheBuster = `_t=${Date.now()}`;
    const response = await fetch(`${API_BASE_URL}/accounts?${cacheBuster}`);
    if (!response.ok) {
      throw new Error('Failed to fetch accounts');
    }
    return response.json();
  },

  // Get a single account by ID
  getAccount: async (id: string): Promise<Account> => {
    // Add a cache-busting parameter to prevent browser caching
    const cacheBuster = `_t=${Date.now()}`;
    const response = await fetch(`${API_BASE_URL}/accounts/${id}?${cacheBuster}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch account with ID ${id}`);
    }
    return response.json();
  },

  // Create a new account
  createAccount: async (account: {
    name: string;
    account_type: string;
    account_sub_type?: string | null;
    balance: number;
    currency: string;
    is_default?: boolean;
  }): Promise<Account> => {
    const response = await fetch(`${API_BASE_URL}/accounts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(account),
    });
    if (!response.ok) {
      throw new Error('Failed to create account');
    }
    return response.json();
  },

  // Update an existing account
  updateAccount: async (id: string, account: Partial<Account>): Promise<Account> => {
    const response = await fetch(`${API_BASE_URL}/accounts/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(account),
    });
    if (!response.ok) {
      throw new Error(`Failed to update account with ID ${id}`);
    }
    return response.json();
  },

  // Delete an account
  deleteAccount: async (id: string): Promise<void> => {
    const response = await fetch(`${API_BASE_URL}/accounts/${id}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      throw new Error(`Failed to delete account with ID ${id}`);
    }
  },

  // Get account ledger with pagination and search
  getLedger: async (
    id: string,
    params?: {
      page?: number;
      limit?: number;
      search?: string;
    }
  ): Promise<LedgerResponse> => {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', params.page.toString());
    if (params?.limit) query.set('limit', params.limit.toString());
    if (params?.search) query.set('search', params.search);
    // Add cache-busting parameter
    query.set('_t', Date.now().toString());

    const response = await fetch(`${API_BASE_URL}/accounts/${id}/ledger?${query.toString()}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch ledger for account with ID ${id}`);
    }
    return response.json();
  },
};

// API functions for transactions
export const transactionsApi = {
  // Get monthly incoming transactions (consistent with budget monthly incoming funds)
  getMonthlyIncomingTransactions: async (year: number, month: number): Promise<Transaction[]> => {
    const cacheBuster = `_t=${Date.now()}`;
    const response = await fetch(`${API_BASE_URL}/transactions/monthly-incoming?year=${year}&month=${month}&${cacheBuster}`);
    if (!response.ok) {
      throw new Error('Failed to fetch monthly incoming transactions');
    }
    return response.json();
  },
  // Get unbudgeted transactions with optional date range (server-side filtered for consistency)
  getUnbudgetedTransactions: async (startDate?: string, endDate?: string): Promise<Transaction[]> => {
    const params = new URLSearchParams();
    if (startDate) params.set('start_date', startDate);
    if (endDate) params.set('end_date', endDate);
    params.set('_t', String(Date.now()));
    const response = await fetch(`${API_BASE_URL}/transactions/unbudgeted?${params.toString()}`);
    if (!response.ok) {
      throw new Error('Failed to fetch unbudgeted transactions');
    }
    return response.json();
  },

  // Get all transactions with pagination
  getTransactions: async (page: number = 1, limit: number = 100): Promise<Transaction[]> => {
    // Add a cache-busting parameter to prevent browser caching
    const cacheBuster = `_t=${Date.now()}`;
    const offset = (page - 1) * limit;
    const response = await fetch(`${API_BASE_URL}/transactions?limit=${limit}&offset=${offset}&${cacheBuster}`);
    if (!response.ok) {
      throw new Error('Failed to fetch transactions');
    }
    return response.json();
  },

  // Get transactions within a date range (inclusive)
  getTransactionsByDateRange: async (
    startDate: string,
    endDate: string,
    limit: number = 1000,
    offset: number = 0
  ): Promise<Transaction[]> => {
    const cacheBuster = `_t=${Date.now()}`;
    const response = await fetch(
      `${API_BASE_URL}/transactions?start_date=${encodeURIComponent(startDate)}&end_date=${encodeURIComponent(endDate)}&limit=${limit}&offset=${offset}&${cacheBuster}`
    );
    if (!response.ok) {
      throw new Error('Failed to fetch transactions by date range');
    }
    return response.json();
  },

  // Get transactions for a specific account with pagination
  getAccountTransactions: async (accountId: string, page: number = 1, limit: number = 100): Promise<Transaction[]> => {
    // Add a cache-busting parameter to prevent browser caching
    const cacheBuster = `_t=${Date.now()}`;
    const offset = (page - 1) * limit;
    const response = await fetch(`${API_BASE_URL}/accounts/${accountId}/transactions?limit=${limit}&offset=${offset}&${cacheBuster}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch transactions for account with ID ${accountId}`);
    }
    return response.json();
  },

  // Get a single transaction by ID
  getTransaction: async (id: string): Promise<Transaction> => {
    // Add a cache-busting parameter to prevent browser caching
    const cacheBuster = `_t=${Date.now()}`;
    const response = await fetch(`${API_BASE_URL}/transactions/${id}?${cacheBuster}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch transaction with ID ${id}`);
    }
    return response.json();
  },

  // Create a new transaction
  createTransaction: async (transaction: Omit<Transaction, 'id' | 'created_at' | 'updated_at'>): Promise<Transaction> => {
    const response = await fetch(`${API_BASE_URL}/transactions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(transaction),
    });
    if (!response.ok) {
      throw new Error('Failed to create transaction');
    }
    return response.json();
  },

  // Update an existing transaction
  updateTransaction: async (id: string, transaction: Partial<Transaction>): Promise<Transaction> => {
    const response = await fetch(`${API_BASE_URL}/transactions/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(transaction),
    });
    if (!response.ok) {
      throw new Error(`Failed to update transaction with ID ${id}`);
    }
    return response.json();
  },

  // Delete a transaction
  deleteTransaction: async (id: string): Promise<void> => {
    const response = await fetch(`${API_BASE_URL}/transactions/${id}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      throw new Error(`Failed to delete transaction with ID ${id}`);
    }
  },

  // Import transactions from CSV
  importTransactions: async (importData: {
    account_id: string;
    column_mapping: {
      description: number | null;
      amount: number | null;
      category: number | null;
      destination_name: number | null;
      transaction_date: number | null;
      budget_id: number | null;
    };
    data: string[][];
  }): Promise<{ success: number; failed: number }> => {
    const response = await fetch(`${API_BASE_URL}/accounts/${importData.account_id}/import-csv`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(importData),
    });
    if (!response.ok) {
      throw new Error('Failed to import transactions');
    }
    return response.json();
  },
};

// API functions for categories
export const categoriesApi = {
  // Get all categories
  getCategories: async (): Promise<Category[]> => {
    // Add a cache-busting parameter to prevent browser caching
    const cacheBuster = `_t=${Date.now()}`;
    const response = await fetch(`${API_BASE_URL}/categories?${cacheBuster}`);
    if (!response.ok) {
      throw new Error('Failed to fetch categories');
    }
    return response.json();
  },

  // Get spending by category
  getCategorySpending: async (startDate?: string, endDate?: string): Promise<CategorySpending[]> => {
    let url = `${API_BASE_URL}/categories/spending`;

    // Add date range parameters if provided
    const params = new URLSearchParams();
    if (startDate) params.append('start_date', startDate);
    if (endDate) params.append('end_date', endDate);

    // Add a cache-busting parameter to prevent browser caching
    params.append('_t', Date.now().toString());

    const queryString = params.toString();
    url += `?${queryString}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error('Failed to fetch category spending');
    }
    return response.json();
  },

  // Get a single category by ID
  getCategory: async (id: string): Promise<Category> => {
    // Add a cache-busting parameter to prevent browser caching
    const cacheBuster = `_t=${Date.now()}`;
    const response = await fetch(`${API_BASE_URL}/categories/${id}?${cacheBuster}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch category with ID ${id}`);
    }
    return response.json();
  },

  // Create a new category
  createCategory: async (category: { name: string; description?: string; group_id?: string }): Promise<Category> => {
    const response = await fetch(`${API_BASE_URL}/categories`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(category),
    });
    if (!response.ok) {
      throw new Error('Failed to create category');
    }
    return response.json();
  },

  // Update an existing category
  updateCategory: async (id: string, category: { name?: string; description?: string; group_id?: string }): Promise<Category> => {
    const response = await fetch(`${API_BASE_URL}/categories/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(category),
    });
    if (!response.ok) {
      throw new Error(`Failed to update category with ID ${id}`);
    }
    return response.json();
  },

  // Delete a category
  deleteCategory: async (id: string): Promise<void> => {
    const response = await fetch(`${API_BASE_URL}/categories/${id}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      throw new Error(`Failed to delete category with ID ${id}`);
    }
  },
};

// API functions for category groups
export const categoryGroupsApi = {
  // Get all category groups
  getCategoryGroups: async (): Promise<CategoryGroup[]> => {
    // Add a cache-busting parameter to prevent browser caching
    const cacheBuster = `_t=${Date.now()}`;
    const response = await fetch(`${API_BASE_URL}/category-groups?${cacheBuster}`);
    if (!response.ok) {
      throw new Error('Failed to fetch category groups');
    }
    return response.json();
  },

  // Get a single category group by ID
  getCategoryGroup: async (id: string): Promise<CategoryGroup> => {
    // Add a cache-busting parameter to prevent browser caching
    const cacheBuster = `_t=${Date.now()}`;
    const response = await fetch(`${API_BASE_URL}/category-groups/${id}?${cacheBuster}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch category group with ID ${id}`);
    }
    return response.json();
  },

  // Create a new category group
  createCategoryGroup: async (categoryGroup: { name: string; description?: string }): Promise<CategoryGroup> => {
    const response = await fetch(`${API_BASE_URL}/category-groups`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(categoryGroup),
    });
    if (!response.ok) {
      throw new Error('Failed to create category group');
    }
    return response.json();
  },

  // Update an existing category group
  updateCategoryGroup: async (id: string, categoryGroup: { name?: string; description?: string }): Promise<CategoryGroup> => {
    const response = await fetch(`${API_BASE_URL}/category-groups/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(categoryGroup),
    });
    if (!response.ok) {
      throw new Error(`Failed to update category group with ID ${id}`);
    }
    return response.json();
  },

  // Delete a category group
  deleteCategoryGroup: async (id: string): Promise<void> => {
    const response = await fetch(`${API_BASE_URL}/category-groups/${id}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      throw new Error(`Failed to delete category group with ID ${id}`);
    }
  },

  // Get all categories in a specific group
  getCategoriesByGroup: async (groupId: string): Promise<Category[]> => {
    // Add a cache-busting parameter to prevent browser caching
    const cacheBuster = `_t=${Date.now()}`;
    const response = await fetch(`${API_BASE_URL}/category-groups/${groupId}/categories?${cacheBuster}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch categories for group with ID ${groupId}`);
    }
    return response.json();
  },
};

export const budgetGroupsApi = {
  // Get all budget groups
  getBudgetGroups: async (): Promise<CategoryGroup[]> => {
    const cacheBuster = `_t=${Date.now()}`;
    const response = await fetch(`${API_BASE_URL}/budget-groups?${cacheBuster}`);
    if (!response.ok) {
      throw new Error('Failed to fetch budget groups');
    }
    return response.json();
  },

  // Create a new budget group
  createBudgetGroup: async (budgetGroup: { name: string; description?: string }): Promise<CategoryGroup> => {
    const response = await fetch(`${API_BASE_URL}/budget-groups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(budgetGroup),
    });
    if (!response.ok) {
      throw new Error('Failed to create budget group');
    }
    return response.json();
  },

  // Update an existing budget group
  updateBudgetGroup: async (id: string, budgetGroup: { name?: string; description?: string }): Promise<CategoryGroup> => {
    const response = await fetch(`${API_BASE_URL}/budget-groups/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(budgetGroup),
    });
    if (!response.ok) {
      throw new Error(`Failed to update budget group with ID ${id}`);
    }
    return response.json();
  },

  // Delete a budget group
  deleteBudgetGroup: async (id: string): Promise<void> => {
    const response = await fetch(`${API_BASE_URL}/budget-groups/${id}`, { method: 'DELETE' });
    if (!response.ok) {
      throw new Error(`Failed to delete budget group with ID ${id}`);
    }
  },
};

export const budgetsApi = {
  // Get all budgets
  getBudgets: async (): Promise<Budget[]> => {
    // Add a cache-busting parameter to prevent browser caching
    const cacheBuster = `_t=${Date.now()}`;
    const response = await fetch(`${API_BASE_URL}/budgets?${cacheBuster}`);
    if (!response.ok) {
      throw new Error('Failed to fetch budgets');
    }
    return response.json();
  },

  // Get active budgets
  getActiveBudgets: async (): Promise<Budget[]> => {
    // Add a cache-busting parameter to prevent browser caching
    const cacheBuster = `_t=${Date.now()}`;
    const response = await fetch(`${API_BASE_URL}/budgets/active?${cacheBuster}`);
    if (!response.ok) {
      throw new Error('Failed to fetch active budgets');
    }
    return response.json();
  },

  // Get monthly budget status
  getMonthlyBudgetStatus: async (year: number, month: number): Promise<MonthlyBudgetStatus> => {
    // Add a cache-busting parameter to prevent browser caching
    const cacheBuster = `_t=${Date.now()}`;
    const response = await fetch(`${API_BASE_URL}/budgets/monthly-status?year=${year}&month=${month}&${cacheBuster}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch monthly budget status for ${year}-${month}`);
    }
    return response.json();
  },

  // Get a single budget by ID
  getBudget: async (id: string): Promise<Budget> => {
    // Add a cache-busting parameter to prevent browser caching
    const cacheBuster = `_t=${Date.now()}`;
    const response = await fetch(`${API_BASE_URL}/budgets/${id}?${cacheBuster}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch budget with ID ${id}`);
    }
    return response.json();
  },

  // Create a new budget
  createBudget: async (budget: Omit<Budget, 'id' | 'created_at' | 'updated_at'>): Promise<Budget> => {
    const response = await fetch(`${API_BASE_URL}/budgets`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(budget),
    });
    if (!response.ok) {
      throw new Error('Failed to create budget');
    }
    return response.json();
  },

  // Update an existing budget
  updateBudget: async (id: string, budget: Partial<Budget>): Promise<Budget> => {
    const response = await fetch(`${API_BASE_URL}/budgets/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(budget),
    });
    if (!response.ok) {
      throw new Error(`Failed to update budget with ID ${id}`);
    }
    return response.json();
  },

  // Delete a budget
  deleteBudget: async (id: string): Promise<void> => {
    const response = await fetch(`${API_BASE_URL}/budgets/${id}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      throw new Error(`Failed to delete budget with ID ${id}`);
    }
  },

  // Get transactions for a budget's month
  getBudgetTransactionsForMonth: async (id: string): Promise<Transaction[]> => {
    const cacheBuster = `_t=${Date.now()}`;
    const response = await fetch(`${API_BASE_URL}/budgets/${id}/transactions?${cacheBuster}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch transactions for budget with ID ${id}`);
    }
    return response.json();
  },

  // Get the total spent amount for a budget
  getBudgetSpent: async (id: string, year?: number, month?: number): Promise<number> => {
    // Add a cache-busting parameter to prevent browser caching
    const params = new URLSearchParams();
    if (typeof year === 'number') params.set('year', String(year));
    if (typeof month === 'number') params.set('month', String(month));
    params.set('_t', String(Date.now()));
    const response = await fetch(`${API_BASE_URL}/budgets/${id}/spent?${params.toString()}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch spent amount for budget with ID ${id}`);
    }
    return response.json();
  },

  // Get the remaining amount for a budget
  getBudgetRemaining: async (id: string): Promise<number> => {
    // Add a cache-busting parameter to prevent browser caching
    const cacheBuster = `_t=${Date.now()}`;
    const response = await fetch(`${API_BASE_URL}/budgets/${id}/remaining?${cacheBuster}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch remaining amount for budget with ID ${id}`);
    }
    return response.json();
  },

  // Get the total spent amount not associated with any budget
  getUnbudgetedSpent: async (year?: number, month?: number): Promise<number> => {
    // Add a cache-busting parameter to prevent browser caching
    const params = new URLSearchParams();
    if (typeof year === 'number') params.set('year', String(year));
    if (typeof month === 'number') params.set('month', String(month));
    params.set('_t', String(Date.now()));
    const response = await fetch(`${API_BASE_URL}/budgets/unbudgeted-spent?${params.toString()}`);
    if (!response.ok) {
      throw new Error('Failed to fetch unbudgeted spent amount');
    }
    return response.json();
  },
};

// API functions for rule groups
export const ruleGroupsApi = {
  // Get all rule groups
  getRuleGroups: async (): Promise<RuleGroup[]> => {
    const cacheBuster = `_t=${Date.now()}`;
    const response = await fetch(`${API_BASE_URL}/rule-groups?${cacheBuster}`);
    if (!response.ok) throw new Error('Failed to fetch rule groups');
    return response.json();
  },
  // Create a new rule group
  createRuleGroup: async (group: { name: string; description?: string }): Promise<RuleGroup> => {
    const response = await fetch(`${API_BASE_URL}/rule-groups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(group),
    });
    if (!response.ok) throw new Error('Failed to create rule group');
    return response.json();
  },
  // Update an existing rule group
  updateRuleGroup: async (id: string, group: { name?: string; description?: string }): Promise<RuleGroup> => {
    const response = await fetch(`${API_BASE_URL}/rule-groups/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(group),
    });
    if (!response.ok) throw new Error(`Failed to update rule group with ID ${id}`);
    return response.json();
  },
  // Delete a rule group
  deleteRuleGroup: async (id: string): Promise<void> => {
    const response = await fetch(`${API_BASE_URL}/rule-groups/${id}`, { method: 'DELETE' });
    if (!response.ok) throw new Error(`Failed to delete rule group with ID ${id}`);
  },
  // Get rules in a specific group
  getRulesByGroup: async (groupId: string): Promise<Rule[]> => {
    const cacheBuster = `_t=${Date.now()}`;
    const response = await fetch(`${API_BASE_URL}/rule-groups/${groupId}/rules?${cacheBuster}`);
    if (!response.ok) throw new Error(`Failed to fetch rules for group with ID ${groupId}`);
    return response.json();
  },
};

// API functions for rules
export const rulesApi = {
  // Get all rules
  getRules: async (): Promise<Rule[]> => {
    // Add a cache-busting parameter to prevent browser caching
    const cacheBuster = `_t=${Date.now()}`;
    const response = await fetch(`${API_BASE_URL}/rules?${cacheBuster}`);
    if (!response.ok) {
      throw new Error('Failed to fetch rules');
    }
    return response.json();
  },

  // Get a single rule by ID
  getRule: async (id: string): Promise<Rule> => {
    // Add a cache-busting parameter to prevent browser caching
    const cacheBuster = `_t=${Date.now()}`;
    const response = await fetch(`${API_BASE_URL}/rules/${id}?${cacheBuster}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch rule with ID ${id}`);
    }
    return response.json();
  },

  // Create a new rule
  createRule: async (rule: {
    name: string;
    description?: string;
    is_active: boolean;
    priority?: number;
    group_id?: string | null;
    conditions: RuleCondition[];
    actions: RuleAction[];
  }): Promise<Rule> => {
    const response = await fetch(`${API_BASE_URL}/rules`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(rule),
    });
    if (!response.ok) {
      throw new Error('Failed to create rule');
    }
    return response.json();
  },

  // Update an existing rule
  updateRule: async (id: string, rule: {
    name?: string;
    description?: string;
    is_active?: boolean;
    priority?: number;
    group_id?: string | null;
    conditions?: RuleCondition[];
    actions?: RuleAction[];
  }): Promise<Rule> => {
    const response = await fetch(`${API_BASE_URL}/rules/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(rule),
    });
    if (!response.ok) {
      throw new Error(`Failed to update rule with ID ${id}`);
    }
    return response.json();
  },

  // Delete a rule
  deleteRule: async (id: string): Promise<void> => {
    const response = await fetch(`${API_BASE_URL}/rules/${id}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      throw new Error(`Failed to delete rule with ID ${id}`);
    }
  },

  // Run all active rules on all transactions
  runAllRules: async (): Promise<{ affected_transactions: number; message: string }> => {
    const response = await fetch(`${API_BASE_URL}/rules/run`, {
      method: 'POST',
    });
    if (!response.ok) {
      throw new Error('Failed to run all rules');
    }
    return response.json();
  },

  // Run a specific rule on all transactions
  runRule: async (id: string): Promise<{ affected_transactions: number; message: string }> => {
    const response = await fetch(`${API_BASE_URL}/rules/${id}/run`, {
      method: 'POST',
    });
    if (!response.ok) {
      throw new Error(`Failed to run rule with ID ${id}`);
    }
    return response.json();
  },

  // Test conditions (without saving a rule)
  testConditions: async (conditions: RuleCondition[]): Promise<RuleTestResponse> => {
    const response = await fetch(`${API_BASE_URL}/rules/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conditions }),
    });
    if (!response.ok) {
      throw new Error('Failed to test rule conditions');
    }
    return response.json();
  },

  // Test an existing rule's conditions by ID
  testRule: async (id: string): Promise<RuleTestResponse> => {
    const response = await fetch(`${API_BASE_URL}/rules/${id}/test`, { method: 'POST' });
    if (!response.ok) {
      throw new Error(`Failed to test rule with ID ${id}`);
    }
    return response.json();
  },
};

// API functions for Firefly III import
export const fireflyImportApi = {
  // Import data from Firefly III
  importFromFirefly: async (options: FireflyImportOptions): Promise<ImportResult> => {
    const response = await fetch(`${API_BASE_URL}/imports/firefly`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(options),
    });
    if (!response.ok) {
      throw new Error('Failed to import from Firefly III');
    }
    return response.json();
  },

  // Upload CSV files for Firefly import
  uploadFireflyCsv: async (accountsFile: File, transactionsFile: File): Promise<ImportResult> => {
    const formData = new FormData();
    formData.append('accounts', accountsFile);
    formData.append('transactions', transactionsFile);

    const response = await fetch(`${API_BASE_URL}/imports/firefly/upload`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to upload CSV files: ${errorText}`);
    }

    return response.json();
  },
};

// API functions for server features
export const featuresApi = {
  getFeatures: async (): Promise<Features> => {
    const cacheBuster = `_t=${Date.now()}`;
    const response = await fetch(`${API_BASE_URL}/features?${cacheBuster}`);
    if (!response.ok) {
      throw new Error('Failed to fetch features');
    }
    return response.json();
  },
};

// API functions for settings
export const settingsApi = {
  // Get forecasted monthly income
  getForecastedMonthlyIncome: async (): Promise<ForecastedMonthlyIncomeResponse> => {
    // Add a cache-busting parameter to prevent browser caching
    const cacheBuster = `_t=${Date.now()}`;
    const response = await fetch(`${API_BASE_URL}/settings/forecasted-monthly-income?${cacheBuster}`);
    if (!response.ok) {
      throw new Error('Failed to fetch forecasted monthly income');
    }
    return response.json();
  },

  // Update forecasted monthly income
  updateForecastedMonthlyIncome: async (amount: number): Promise<ForecastedMonthlyIncomeResponse> => {
    const response = await fetch(`${API_BASE_URL}/settings/forecasted-monthly-income`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ value: amount.toString() }),
    });
    if (!response.ok) {
      throw new Error('Failed to update forecasted monthly income');
    }
    return response.json();
  },
};
