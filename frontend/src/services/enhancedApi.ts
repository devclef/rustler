// Enhanced API service with retry logic, loading states, and error handling
import { fetchWithRetry, LedgerError } from '../utils/errorHandling';
import type {
  LedgerTransaction,
  LedgerResponse,
  ClearedStatus,
  PayeeAutocompleteResponse,
  LastCategoryResponse,
} from './types';

// API base URL
const API_BASE_URL = '/api';

// Enhanced API wrapper with loading states and error handling
class EnhancedApiService {
  private loadingStates = new Map<string, boolean>();
  private onLoadingChange?: (key: string, loading: boolean) => void;

  constructor(onLoadingChange?: (key: string, loading: boolean) => void) {
    this.onLoadingChange = onLoadingChange;
  }

  private setLoading(key: string, loading: boolean) {
    this.loadingStates.set(key, loading);
    if (this.onLoadingChange) {
      this.onLoadingChange(key, loading);
    }
  }

  isLoading(key: string): boolean {
    return this.loadingStates.get(key) || false;
  }

  // Enhanced fetch wrapper
  private async enhancedFetch<T>(
    url: string,
    options: RequestInit = {},
    loadingKey?: string,
    maxRetries: number = 2
  ): Promise<T> {
    if (loadingKey) {
      this.setLoading(loadingKey, true);
    }

    try {
      const response = await fetchWithRetry(url, options, maxRetries);
      const data = await response.json();
      return data;
    } finally {
      if (loadingKey) {
        this.setLoading(loadingKey, false);
      }
    }
  }

  // Account ledger operations
  async getLedger(
    accountId: string,
    params?: {
      page?: number;
      limit?: number;
      search?: string;
    }
  ): Promise<LedgerResponse> {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', params.page.toString());
    if (params?.limit) query.set('limit', params.limit.toString());
    if (params?.search) query.set('search', params.search);
    query.set('_t', Date.now().toString());

    return this.enhancedFetch<LedgerResponse>(
      `${API_BASE_URL}/accounts/${accountId}/ledger?${query.toString()}`,
      {},
      `ledger-${accountId}`
    );
  }

  // Transaction operations
  async createTransaction(transaction: any): Promise<LedgerTransaction> {
    return this.enhancedFetch<LedgerTransaction>(
      `${API_BASE_URL}/transactions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(transaction),
      },
      'create-transaction'
    );
  }

  async updateTransaction(id: string, updates: any): Promise<LedgerTransaction> {
    return this.enhancedFetch<LedgerTransaction>(
      `${API_BASE_URL}/transactions/${id}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      },
      `update-transaction-${id}`
    );
  }

  async deleteTransaction(id: string): Promise<void> {
    await this.enhancedFetch<void>(
      `${API_BASE_URL}/transactions/${id}`,
      { method: 'DELETE' },
      `delete-transaction-${id}`
    );
  }

  async updateClearedStatus(id: string, status: ClearedStatus): Promise<LedgerTransaction> {
    return this.enhancedFetch<LedgerTransaction>(
      `${API_BASE_URL}/transactions/${id}/cleared-status`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      },
      `update-cleared-${id}`
    );
  }

  async bulkUpdateTransactions(
    transactionIds: string[],
    updates: any
  ): Promise<{ updated: number; failed: string[] }> {
    return this.enhancedFetch<{ updated: number; failed: string[] }>(
      `${API_BASE_URL}/transactions/bulk-update`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionIds, updates }),
      },
      'bulk-update'
    );
  }

  // Payee operations
  async getPayeeAutocomplete(query?: string): Promise<PayeeAutocompleteResponse> {
    const params = new URLSearchParams();
    if (query) params.set('query', query);
    params.set('_t', Date.now().toString());

    return this.enhancedFetch<PayeeAutocompleteResponse>(
      `${API_BASE_URL}/payees/autocomplete?${params.toString()}`,
      {},
      'payee-autocomplete'
    );
  }

  async getLastCategory(payeeName: string): Promise<LastCategoryResponse> {
    return this.enhancedFetch<LastCategoryResponse>(
      `${API_BASE_URL}/payees/${encodeURIComponent(payeeName)}/last-category`,
      {},
      `last-category-${payeeName}`
    );
  }
}

// Create singleton instance
export const enhancedApi = new EnhancedApiService();

// Hook for using enhanced API with loading states
export const useEnhancedApi = () => {
  return enhancedApi;
};