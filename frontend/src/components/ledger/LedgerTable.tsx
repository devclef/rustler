import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { FixedSizeList as List } from 'react-window';
import type { LedgerTransaction, Account, Category, ClearedStatus } from '../../services/types';
import { accountsApi, categoriesApi, transactionsApi } from '../../services/api';
import { enhancedApi } from '../../services/enhancedApi';
import { calculateAndApplyRunningBalances } from '../../services/runningBalance';
import { OptimisticUpdateManager } from '../../utils/errorHandling';
import { useToast } from '../../hooks/useToast';
import TransactionRow from './TransactionRow';
import NewTransactionRow, { type NewTransactionRowRef } from './NewTransactionRow';
import BulkEditToolbar from './BulkEditToolbar';
import MobileTransactionCard from './MobileTransactionCard';
import MobileNewTransactionModal from './MobileNewTransactionModal';
import MobileEditTransactionModal from './MobileEditTransactionModal';
import LoadingSpinner from '../common/LoadingSpinner';
import ErrorDisplay from '../common/ErrorDisplay';
import { ToastContainer } from '../common/Toast';
import './LedgerTable.css';

interface LedgerTableProps {
  accountId: string;
}

interface FilterState {
  search: string;
  dateRange: {
    start: string | null;
    end: string | null;
  };
  category: string | null;
  clearedStatus: ClearedStatus | null;
}

const LedgerTable: React.FC<LedgerTableProps> = ({ accountId }) => {
  // State management
  const [account, setAccount] = useState<Account | null>(null);
  const [transactions, setTransactions] = useState<LedgerTransaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  
  // Toast notifications
  const {
    toasts,
    removeToast,
    showSuccess,
    showError,
    showWarning,
  } = useToast();
  
  // Optimistic updates manager
  const optimisticManager = useMemo(
    () => new OptimisticUpdateManager<LedgerTransaction>(setTransactions),
    []
  );
  
  // Filter and search state
  const [filters, setFilters] = useState<FilterState>({
    search: '',
    dateRange: { start: null, end: null },
    category: null,
    clearedStatus: null,
  });
  
  // Selection state for bulk operations
  const [selectedTransactionIds, setSelectedTransactionIds] = useState<Set<string>>(new Set());
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  
  const ITEMS_PER_PAGE = 100; // Increased for virtual scrolling
  const ROW_HEIGHT = 48; // Height of each transaction row in pixels
  const VIRTUAL_LIST_HEIGHT = 600; // Height of the virtual list container

  // Refs for keyboard shortcuts and virtual scrolling
  const searchInputRef = useRef<HTMLInputElement>(null);
  const newTransactionRowRef = useRef<NewTransactionRowRef>(null);
  const virtualListRef = useRef<List>(null);
  
  // Virtual scrolling state
  const [isVirtualScrollEnabled, setIsVirtualScrollEnabled] = useState(false);

  // Mobile state
  const [showMobileNewModal, setShowMobileNewModal] = useState(false);
  const [showMobileEditModal, setShowMobileEditModal] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<LedgerTransaction | null>(null);

  // Virtualized Row Component
  const VirtualizedRow = useCallback(({ index, style }: { index: number; style: React.CSSProperties }) => {
    const transaction = filteredTransactions[index];
    
    if (!transaction) {
      return (
        <div style={style} className="virtual-row-loading">
          <div className="loading-spinner">Loading...</div>
        </div>
      );
    }

    return (
      <div style={style} className="virtual-row">
        <TransactionRow
          transaction={transaction}
          accountId={accountId}
          onTransactionUpdate={handleTransactionUpdate}
          onTransactionDelete={handleTransactionDelete}
          isSelected={selectedTransactionIds.has(transaction.id)}
          onSelectionChange={handleTransactionSelection}
        />
      </div>
    );
  }, [filteredTransactions, accountId, selectedTransactionIds, handleTransactionUpdate, handleTransactionDelete, handleTransactionSelection]);

  // Load account data
  const loadAccount = useCallback(async () => {
    try {
      const accountData = await accountsApi.getAccount(accountId);
      setAccount(accountData);
      setError(null);
    } catch (err) {
      console.error('Error loading account:', err);
      setError(err);
      showError('Failed to load account information');
    }
  }, [accountId, showError]);

  // Load categories for filtering
  const loadCategories = useCallback(async () => {
    try {
      const categoriesData = await categoriesApi.getCategories();
      setCategories(categoriesData);
    } catch (err) {
      console.error('Error loading categories:', err);
      showWarning('Failed to load categories for filtering');
    }
  }, [showWarning]);

  // Load transactions with current filters
  const loadTransactions = useCallback(async (page: number = 1, append: boolean = false) => {
    try {
      setLoading(true);
      setError(null);
      
      const params: any = {
        page,
        limit: ITEMS_PER_PAGE,
      };
      
      // Add search parameter if present
      if (filters.search.trim()) {
        params.search = filters.search.trim();
      }
      
      const response = await enhancedApi.getLedger(accountId, params);
      
      // Calculate running balances
      const transactionsWithBalances = calculateAndApplyRunningBalances(
        response.transactions,
        response.current_balance
      );
      
      if (append) {
        setTransactions(prev => [...prev, ...transactionsWithBalances]);
      } else {
        setTransactions(transactionsWithBalances);
      }
      
      setTotalCount(response.total_count);
      setHasMore(response.transactions.length === ITEMS_PER_PAGE);
      setCurrentPage(page);
      setRetryCount(0); // Reset retry count on success
      
    } catch (err) {
      console.error('Error loading transactions:', err);
      setError(err);
      if (retryCount === 0) {
        showError('Failed to load transactions', {
          action: {
            label: 'Retry',
            onClick: () => {
              setRetryCount(prev => prev + 1);
              loadTransactions(page, append);
            }
          }
        });
      }
    } finally {
      setLoading(false);
    }
  }, [accountId, filters.search, retryCount, showError]);

  // Initial data loading
  useEffect(() => {
    loadAccount();
    loadCategories();
  }, [loadAccount, loadCategories]);

  // Load transactions when account or filters change
  useEffect(() => {
    if (accountId) {
      loadTransactions(1, false);
      setSelectedTransactionIds(new Set()); // Clear selection when filters change
    }
  }, [accountId, loadTransactions]);

  // Enable virtual scrolling for large datasets
  useEffect(() => {
    setIsVirtualScrollEnabled(filteredTransactions.length > 100);
  }, [filteredTransactions.length]);

  // Apply client-side filters to transactions
  const filteredTransactions = useMemo(() => {
    let filtered = [...transactions];
    
    // Date range filter
    if (filters.dateRange.start || filters.dateRange.end) {
      filtered = filtered.filter(transaction => {
        const transactionDate = new Date(transaction.date);
        const startDate = filters.dateRange.start ? new Date(filters.dateRange.start) : null;
        const endDate = filters.dateRange.end ? new Date(filters.dateRange.end) : null;
        
        if (startDate && transactionDate < startDate) return false;
        if (endDate && transactionDate > endDate) return false;
        return true;
      });
    }
    
    // Category filter
    if (filters.category) {
      filtered = filtered.filter(transaction => 
        transaction.category === filters.category
      );
    }
    
    // Cleared status filter
    if (filters.clearedStatus) {
      filtered = filtered.filter(transaction => 
        transaction.cleared_status === filters.clearedStatus
      );
    }
    
    // Recalculate running balances for filtered transactions
    if (account && (filters.dateRange.start || filters.dateRange.end || filters.category || filters.clearedStatus)) {
      calculateAndApplyRunningBalances(filtered, account.balance);
    }
    
    return filtered;
  }, [transactions, filters, account]);

  // Handle transaction updates with optimistic updates
  const handleTransactionUpdate = useCallback(async (updatedTransaction: LedgerTransaction, optimistic: boolean = false) => {
    if (optimistic) {
      // Apply optimistic update
      const originalTransaction = transactions.find(t => t.id === updatedTransaction.id);
      if (originalTransaction) {
        const optimisticUpdate = {
          id: updatedTransaction.id,
          type: 'update' as const,
          data: updatedTransaction,
          originalData: originalTransaction,
        };
        
        const updatedTransactions = optimisticManager.applyUpdate(optimisticUpdate, transactions);
        
        // Recalculate running balances
        if (account) {
          calculateAndApplyRunningBalances(updatedTransactions, account.balance);
        }
        
        return;
      }
    }
    
    // Apply confirmed update
    setTransactions(prev => {
      const updated = prev.map(t => 
        t.id === updatedTransaction.id ? updatedTransaction : t
      );
      
      // Recalculate running balances after update
      if (account) {
        calculateAndApplyRunningBalances(updated, account.balance);
      }
      
      return updated;
    });
    
    // Confirm optimistic update if it was optimistic
    if (optimistic) {
      optimisticManager.confirmUpdate(updatedTransaction.id, transactions);
    }
    
    // Reload account to get updated balance
    loadAccount();
    showSuccess('Transaction updated successfully');
  }, [account, loadAccount, transactions, optimisticManager, showSuccess]);

  // Handle transaction creation with optimistic updates
  const handleTransactionCreate = useCallback(async (newTransaction: LedgerTransaction, optimistic: boolean = false) => {
    if (optimistic) {
      // Apply optimistic update
      const optimisticUpdate = {
        id: newTransaction.id,
        type: 'create' as const,
        data: newTransaction,
      };
      
      const updatedTransactions = optimisticManager.applyUpdate(optimisticUpdate, transactions);
      
      // Sort and recalculate running balances
      const sorted = updatedTransactions.sort((a, b) => 
        new Date(b.date).getTime() - new Date(a.date).getTime()
      );
      
      if (account) {
        calculateAndApplyRunningBalances(sorted, account.balance);
      }
      
      return;
    }
    
    // Apply confirmed creation
    setTransactions(prev => {
      // Insert new transaction in chronological order
      const updated = [...prev, newTransaction].sort((a, b) => 
        new Date(b.date).getTime() - new Date(a.date).getTime()
      );
      
      // Recalculate running balances
      if (account) {
        calculateAndApplyRunningBalances(updated, account.balance);
      }
      
      return updated;
    });
    
    // Confirm optimistic update if it was optimistic
    if (optimistic) {
      optimisticManager.confirmUpdate(newTransaction.id, transactions);
    }
    
    // Reload account to get updated balance
    loadAccount();
    showSuccess('Transaction created successfully');
  }, [account, loadAccount, transactions, optimisticManager, showSuccess]);

  // Handle transaction deletion with optimistic updates
  const handleTransactionDelete = useCallback(async (transactionId: string, optimistic: boolean = false) => {
    if (optimistic) {
      // Apply optimistic update
      const originalTransaction = transactions.find(t => t.id === transactionId);
      if (originalTransaction) {
        const optimisticUpdate = {
          id: transactionId,
          type: 'delete' as const,
          data: originalTransaction,
          originalData: originalTransaction,
        };
        
        const updatedTransactions = optimisticManager.applyUpdate(optimisticUpdate, transactions);
        
        // Recalculate running balances
        if (account) {
          calculateAndApplyRunningBalances(updatedTransactions, account.balance);
        }
        
        return;
      }
    }
    
    // Apply confirmed deletion
    setTransactions(prev => {
      const updated = prev.filter(t => t.id !== transactionId);
      
      // Recalculate running balances after deletion
      if (account) {
        calculateAndApplyRunningBalances(updated, account.balance);
      }
      
      return updated;
    });
    
    // Confirm optimistic update if it was optimistic
    if (optimistic) {
      optimisticManager.confirmUpdate(transactionId, transactions);
    }
    
    // Remove from selection if selected
    setSelectedTransactionIds(prev => {
      const updated = new Set(prev);
      updated.delete(transactionId);
      return updated;
    });
    
    // Reload account to get updated balance
    loadAccount();
    showSuccess('Transaction deleted successfully');
  }, [account, loadAccount, transactions, optimisticManager, showSuccess]);

  // Handle transaction selection
  const handleTransactionSelection = useCallback((transactionId: string, selected: boolean) => {
    setSelectedTransactionIds(prev => {
      const updated = new Set(prev);
      if (selected) {
        updated.add(transactionId);
      } else {
        updated.delete(transactionId);
      }
      return updated;
    });
  }, []);

  // Handle select all toggle
  const handleSelectAll = useCallback(() => {
    const allSelected = selectedTransactionIds.size === filteredTransactions.length;
    if (allSelected) {
      setSelectedTransactionIds(new Set());
    } else {
      setSelectedTransactionIds(new Set(filteredTransactions.map(t => t.id)));
    }
  }, [selectedTransactionIds.size, filteredTransactions]);

  // Handle filter changes
  const handleSearchChange = useCallback((search: string) => {
    setFilters(prev => ({ ...prev, search }));
  }, []);

  const handleDateRangeChange = useCallback((start: string | null, end: string | null) => {
    setFilters(prev => ({ ...prev, dateRange: { start, end } }));
  }, []);

  const handleCategoryFilterChange = useCallback((category: string | null) => {
    setFilters(prev => ({ ...prev, category }));
  }, []);

  const handleClearedStatusFilterChange = useCallback((clearedStatus: ClearedStatus | null) => {
    setFilters(prev => ({ ...prev, clearedStatus }));
  }, []);

  // Clear all filters
  const clearFilters = useCallback(() => {
    setFilters({
      search: '',
      dateRange: { start: null, end: null },
      category: null,
      clearedStatus: null,
    });
  }, []);

  // Load more transactions (for virtual scrolling)
  const loadMore = useCallback(() => {
    if (!loading && hasMore) {
      loadTransactions(currentPage + 1, true);
    }
  }, [loading, hasMore, currentPage, loadTransactions]);

  // Handle scroll for infinite loading in virtual list
  const handleVirtualScroll = useCallback(({ scrollOffset, scrollDirection }: any) => {
    if (scrollDirection === 'forward') {
      const totalHeight = filteredTransactions.length * ROW_HEIGHT;
      const visibleHeight = VIRTUAL_LIST_HEIGHT;
      const scrollPercentage = scrollOffset / (totalHeight - visibleHeight);
      
      // Load more when scrolled 80% down
      if (scrollPercentage > 0.8 && hasMore && !loading) {
        loadMore();
      }
    }
  }, [filteredTransactions.length, hasMore, loading, loadMore]);

  // Handle keyboard shortcuts
  const handleKeyboardShortcuts = useCallback((e: KeyboardEvent) => {
    // Don't handle shortcuts if user is typing in an input field
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
      return;
    }

    const isCtrlOrCmd = e.ctrlKey || e.metaKey;

    if (isCtrlOrCmd && e.key === 'n') {
      // Ctrl/Cmd+N: Focus new transaction row
      e.preventDefault();
      if (newTransactionRowRef.current) {
        newTransactionRowRef.current.focusDateField();
      }
    } else if (isCtrlOrCmd && e.key === 'f') {
      // Ctrl/Cmd+F: Focus search box
      e.preventDefault();
      if (searchInputRef.current) {
        searchInputRef.current.focus();
        searchInputRef.current.select();
      }
    } else if (e.key === 'Delete' && selectedTransactionIds.size > 0) {
      // Delete: Delete selected transactions
      e.preventDefault();
      handleDeleteSelectedTransactions();
    } else if (e.key === 'c' && selectedTransactionIds.size > 0) {
      // C: Toggle cleared status of selected transactions
      e.preventDefault();
      handleToggleClearedStatusForSelected();
    } else if (e.key === 'Escape') {
      // Escape: Clear selection
      e.preventDefault();
      setSelectedTransactionIds(new Set());
    }
  }, [selectedTransactionIds]);

  // Handle deleting selected transactions
  const handleDeleteSelectedTransactions = useCallback(async () => {
    if (selectedTransactionIds.size === 0) return;

    const count = selectedTransactionIds.size;
    const message = count === 1 
      ? 'Are you sure you want to delete this transaction?' 
      : `Are you sure you want to delete these ${count} transactions?`;

    if (window.confirm(message)) {
      try {
        // Apply optimistic updates first
        const transactionsToDelete = transactions.filter(t => selectedTransactionIds.has(t.id));
        transactionsToDelete.forEach(transaction => {
          const optimisticUpdate = {
            id: transaction.id,
            type: 'delete' as const,
            data: transaction,
            originalData: transaction,
          };
          optimisticManager.applyUpdate(optimisticUpdate, transactions);
        });

        // Delete each transaction
        const deletePromises = Array.from(selectedTransactionIds).map(id =>
          enhancedApi.deleteTransaction(id)
        );
        
        await Promise.all(deletePromises);
        
        // Confirm optimistic updates
        transactionsToDelete.forEach(transaction => {
          optimisticManager.confirmUpdate(transaction.id, transactions);
        });
        
        // Remove deleted transactions from state
        setTransactions(prev => {
          const updated = prev.filter(t => !selectedTransactionIds.has(t.id));
          
          // Recalculate running balances after deletion
          if (account) {
            calculateAndApplyRunningBalances(updated, account.balance);
          }
          
          return updated;
        });
        
        // Clear selection
        setSelectedTransactionIds(new Set());
        
        // Reload account to get updated balance
        loadAccount();
        
        showSuccess(`${count} transaction${count > 1 ? 's' : ''} deleted successfully`);
        
      } catch (err) {
        console.error('Error deleting transactions:', err);
        
        // Revert optimistic updates
        transactionsToDelete.forEach(transaction => {
          optimisticManager.revertUpdate(transaction.id, transactions);
        });
        
        showError('Failed to delete some transactions. Please try again.');
      }
    }
  }, [selectedTransactionIds, account, loadAccount, transactions, optimisticManager, showSuccess, showError]);

  // Handle toggling cleared status for selected transactions
  const handleToggleClearedStatusForSelected = useCallback(async () => {
    if (selectedTransactionIds.size === 0) return;

    try {
      // Get the first selected transaction to determine the next status
      const firstSelectedTransaction = transactions.find(t => selectedTransactionIds.has(t.id));
      if (!firstSelectedTransaction) return;

      // Cycle through cleared status: uncleared → cleared → reconciled → uncleared
      const statusCycle: ClearedStatus[] = ['uncleared', 'cleared', 'reconciled'];
      const currentIndex = statusCycle.indexOf(firstSelectedTransaction.cleared_status);
      const nextStatus = statusCycle[(currentIndex + 1) % statusCycle.length];

      // Apply optimistic updates first
      const transactionsToUpdate = transactions.filter(t => selectedTransactionIds.has(t.id));
      transactionsToUpdate.forEach(transaction => {
        const updatedTransaction = { ...transaction, cleared_status: nextStatus };
        const optimisticUpdate = {
          id: transaction.id,
          type: 'update' as const,
          data: updatedTransaction,
          originalData: transaction,
        };
        optimisticManager.applyUpdate(optimisticUpdate, transactions);
      });

      // Update all selected transactions
      const updatePromises = Array.from(selectedTransactionIds).map(id =>
        enhancedApi.updateClearedStatus(id, nextStatus)
      );
      
      await Promise.all(updatePromises);
      
      // Confirm optimistic updates
      transactionsToUpdate.forEach(transaction => {
        optimisticManager.confirmUpdate(transaction.id, transactions);
      });
      
      // Update transactions in state
      setTransactions(prev => 
        prev.map(t => 
          selectedTransactionIds.has(t.id) 
            ? { ...t, cleared_status: nextStatus }
            : t
        )
      );
      
      // Reload account to get updated cleared balance
      loadAccount();
      
      const count = selectedTransactionIds.size;
      showSuccess(`${count} transaction${count > 1 ? 's' : ''} marked as ${nextStatus}`);
      
    } catch (err) {
      console.error('Error updating cleared status:', err);
      
      // Revert optimistic updates
      const transactionsToUpdate = transactions.filter(t => selectedTransactionIds.has(t.id));
      transactionsToUpdate.forEach(transaction => {
        optimisticManager.revertUpdate(transaction.id, transactions);
      });
      
      showError('Failed to update cleared status for some transactions. Please try again.');
    }
  }, [selectedTransactionIds, transactions, loadAccount, optimisticManager, showSuccess, showError]);

  // Handle mobile edit transaction
  const handleMobileEditTransaction = useCallback((transaction: LedgerTransaction) => {
    setEditingTransaction(transaction);
    setShowMobileEditModal(true);
  }, []);

  // Handle mobile new transaction
  const handleMobileNewTransaction = useCallback(() => {
    setShowMobileNewModal(true);
  }, []);

  // Add keyboard event listener
  useEffect(() => {
    document.addEventListener('keydown', handleKeyboardShortcuts);
    return () => {
      document.removeEventListener('keydown', handleKeyboardShortcuts);
    };
  }, [handleKeyboardShortcuts]);

  // Check if any filters are active
  const hasActiveFilters = filters.search.trim() || 
    filters.dateRange.start || 
    filters.dateRange.end || 
    filters.category || 
    filters.clearedStatus;

  // Retry function for error recovery
  const handleRetry = useCallback(() => {
    setError(null);
    setRetryCount(prev => prev + 1);
    loadAccount();
    loadCategories();
    loadTransactions(1, false);
  }, [loadAccount, loadCategories, loadTransactions]);

  if (error && !account) {
    return (
      <div className="ledger-table-container">
        <ErrorDisplay
          error={error}
          title="Failed to Load Ledger"
          onRetry={handleRetry}
          variant="banner"
          className="ledger-error"
        />
        <ToastContainer toasts={toasts} onDismiss={removeToast} />
      </div>
    );
  }

  if (!account && loading) {
    return (
      <div className="ledger-table-container">
        <LoadingSpinner 
          size="large" 
          message="Loading account information..." 
          className="ledger-loading"
        />
        <ToastContainer toasts={toasts} onDismiss={removeToast} />
      </div>
    );
  }

  return (
    <div className="ledger-table-container">
      {/* Account Header */}
      <div className="ledger-header">
        <div className="account-info">
          <h2 className="account-name">{account.name}</h2>
          <div className="account-balances">
            <div className="balance-item">
              <span className="balance-label">Current Balance:</span>
              <span className="balance-amount current">
                ${account.balance.toFixed(2)}
              </span>
            </div>
            <div className="balance-item">
              <span className="balance-label">Cleared Balance:</span>
              <span className="balance-amount cleared">
                ${(account as any).cleared_balance?.toFixed(2) || '0.00'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Search and Filter Controls */}
      <div className="ledger-controls">
        <div className="search-controls">
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search transactions... (Ctrl+F)"
            value={filters.search}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="search-input"
          />
        </div>
        
        <div className="filter-controls">
          <div className="filter-group">
            <label>Date Range:</label>
            <input
              type="date"
              value={filters.dateRange.start || ''}
              onChange={(e) => handleDateRangeChange(e.target.value || null, filters.dateRange.end)}
              className="date-input"
            />
            <span>to</span>
            <input
              type="date"
              value={filters.dateRange.end || ''}
              onChange={(e) => handleDateRangeChange(filters.dateRange.start, e.target.value || null)}
              className="date-input"
            />
          </div>
          
          <div className="filter-group">
            <label>Category:</label>
            <select
              value={filters.category || ''}
              onChange={(e) => handleCategoryFilterChange(e.target.value || null)}
              className="category-filter"
            >
              <option value="">All Categories</option>
              {categories.map(category => (
                <option key={category.id} value={category.name}>
                  {category.name}
                </option>
              ))}
            </select>
          </div>
          
          <div className="filter-group">
            <label>Status:</label>
            <select
              value={filters.clearedStatus || ''}
              onChange={(e) => handleClearedStatusFilterChange((e.target.value as ClearedStatus) || null)}
              className="status-filter"
            >
              <option value="">All Statuses</option>
              <option value="uncleared">Uncleared</option>
              <option value="cleared">Cleared</option>
              <option value="reconciled">Reconciled</option>
            </select>
          </div>
          
          {hasActiveFilters && (
            <button onClick={clearFilters} className="clear-filters-btn">
              Clear Filters
            </button>
          )}
        </div>
        
        {hasActiveFilters && (
          <div className="active-filters">
            <span>Active filters:</span>
            {filters.search && <span className="filter-tag">Search: "{filters.search}"</span>}
            {filters.dateRange.start && <span className="filter-tag">From: {filters.dateRange.start}</span>}
            {filters.dateRange.end && <span className="filter-tag">To: {filters.dateRange.end}</span>}
            {filters.category && <span className="filter-tag">Category: {filters.category}</span>}
            {filters.clearedStatus && <span className="filter-tag">Status: {filters.clearedStatus}</span>}
          </div>
        )}
      </div>

      {/* Bulk Edit Toolbar */}
      {selectedTransactionIds.size > 0 && (
        <BulkEditToolbar
          selectedTransactionIds={selectedTransactionIds}
          onBulkUpdate={() => {
            // Reload transactions after bulk update
            loadTransactions(1, false);
            setSelectedTransactionIds(new Set());
          }}
          onClearSelection={() => setSelectedTransactionIds(new Set())}
        />
      )}

      {/* Transaction Table */}
      <div className="ledger-table-wrapper">
        {isVirtualScrollEnabled ? (
          /* Virtual Scrolling Table for Large Datasets */
          <div className="virtual-ledger-container">
            {/* Table Header */}
            <table className="ledger-table ledger-table-header">
              <thead>
                <tr>
                  <th className="select-column">
                    <input
                      type="checkbox"
                      checked={filteredTransactions.length > 0 && selectedTransactionIds.size === filteredTransactions.length}
                      onChange={handleSelectAll}
                      aria-label="Select all transactions"
                    />
                  </th>
                  <th className="cleared-column">Status</th>
                  <th className="date-column">Date</th>
                  <th className="payee-column">Payee</th>
                  <th className="category-column">Category</th>
                  <th className="amount-column">Outflow</th>
                  <th className="amount-column">Inflow</th>
                  <th className="amount-column">Balance</th>
                  <th className="memo-column">Memo</th>
                  <th className="actions-column">Actions</th>
                </tr>
              </thead>
            </table>

            {/* New Transaction Row */}
            <div className="new-transaction-wrapper">
              <table className="ledger-table">
                <tbody>
                  <NewTransactionRow
                    ref={newTransactionRowRef}
                    accountId={accountId}
                    onTransactionCreate={handleTransactionCreate}
                  />
                </tbody>
              </table>
            </div>

            {/* Virtual List */}
            {filteredTransactions.length > 0 ? (
              <List
                ref={virtualListRef}
                height={VIRTUAL_LIST_HEIGHT}
                itemCount={filteredTransactions.length}
                itemSize={ROW_HEIGHT}
                onScroll={handleVirtualScroll}
                className="virtual-transaction-list"
              >
                {VirtualizedRow}
              </List>
            ) : (
              <div className="empty-state">
                <div className="empty-state-content">
                  {hasActiveFilters ? 'No transactions match your filters.' : 'No transactions found.'}
                </div>
              </div>
            )}

            {/* Loading indicator for virtual list */}
            {loading && (
              <div className="virtual-loading">
                <LoadingSpinner 
                  size="medium" 
                  message="Loading more transactions..." 
                />
              </div>
            )}
          </div>
        ) : (
          /* Regular Table for Small Datasets */
          <table className="ledger-table">
            <thead>
              <tr>
                <th className="select-column">
                  <input
                    type="checkbox"
                    checked={filteredTransactions.length > 0 && selectedTransactionIds.size === filteredTransactions.length}
                    onChange={handleSelectAll}
                    aria-label="Select all transactions"
                  />
                </th>
                <th className="cleared-column">Status</th>
                <th className="date-column">Date</th>
                <th className="payee-column">Payee</th>
                <th className="category-column">Category</th>
                <th className="amount-column">Outflow</th>
                <th className="amount-column">Inflow</th>
                <th className="amount-column">Balance</th>
                <th className="memo-column">Memo</th>
                <th className="actions-column">Actions</th>
              </tr>
            </thead>
            <tbody>
              {/* New Transaction Row */}
              <NewTransactionRow
                ref={newTransactionRowRef}
                accountId={accountId}
                onTransactionCreate={handleTransactionCreate}
              />
              
              {/* Transaction Rows */}
              {filteredTransactions.map(transaction => (
                <TransactionRow
                  key={transaction.id}
                  transaction={transaction}
                  accountId={accountId}
                  onTransactionUpdate={handleTransactionUpdate}
                  onTransactionDelete={handleTransactionDelete}
                  isSelected={selectedTransactionIds.has(transaction.id)}
                  onSelectionChange={handleTransactionSelection}
                />
              ))}
              
              {/* Loading row */}
              {loading && (
                <tr>
                  <td colSpan={10} className="loading-row">
                    <LoadingSpinner 
                      size="small" 
                      message="Loading transactions..." 
                    />
                  </td>
                </tr>
              )}
              
              {/* Empty state */}
              {!loading && filteredTransactions.length === 0 && (
                <tr>
                  <td colSpan={10} className="empty-row">
                    {hasActiveFilters ? 'No transactions match your filters.' : 'No transactions found.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Mobile Ledger View */}
      <div className="mobile-ledger-view">
        {filteredTransactions.length > 0 ? (
          filteredTransactions.map(transaction => (
            <MobileTransactionCard
              key={transaction.id}
              transaction={transaction}
              accountId={accountId}
              onTransactionUpdate={handleTransactionUpdate}
              onTransactionDelete={handleTransactionDelete}
              isSelected={selectedTransactionIds.has(transaction.id)}
              onSelectionChange={handleTransactionSelection}
              onEdit={handleMobileEditTransaction}
            />
          ))
        ) : (
          <div className="mobile-empty-state">
            <div className="mobile-empty-state-icon">💳</div>
            <div className="mobile-empty-state-text">
              {hasActiveFilters ? 'No transactions match your filters' : 'No transactions yet'}
            </div>
            <div className="mobile-empty-state-hint">
              {hasActiveFilters ? 'Try adjusting your search or filters' : 'Tap the + button to add your first transaction'}
            </div>
          </div>
        )}

        {/* Mobile Loading */}
        {loading && (
          <div className="mobile-loading">
            <LoadingSpinner 
              size="medium" 
              message="Loading transactions..." 
            />
          </div>
        )}

        {/* Mobile Load More */}
        {hasMore && !loading && (
          <div className="load-more-container">
            <button onClick={loadMore} className="load-more-btn">
              Load More Transactions
            </button>
          </div>
        )}
      </div>

      {/* Load More Button (for desktop) */}
      {hasMore && !loading && (
        <div className="load-more-container desktop-only">
          <button onClick={loadMore} className="load-more-btn">
            Load More Transactions
          </button>
        </div>
      )}
      
      {/* Transaction Count */}
      <div className="transaction-count">
        Showing {filteredTransactions.length} of {totalCount} transactions
        {selectedTransactionIds.size > 0 && (
          <span className="selection-count">
            {' • '}{selectedTransactionIds.size} selected
          </span>
        )}
      </div>

      {/* Mobile New Transaction Button */}
      <button
        className="mobile-new-transaction-btn"
        onClick={handleMobileNewTransaction}
        aria-label="Add new transaction"
      >
        +
      </button>

      {/* Mobile Modals */}
      <MobileNewTransactionModal
        isOpen={showMobileNewModal}
        onClose={() => setShowMobileNewModal(false)}
        accountId={accountId}
        onTransactionCreate={handleTransactionCreate}
      />

      <MobileEditTransactionModal
        isOpen={showMobileEditModal}
        onClose={() => {
          setShowMobileEditModal(false);
          setEditingTransaction(null);
        }}
        transaction={editingTransaction}
        accountId={accountId}
        onTransactionUpdate={handleTransactionUpdate}
      />

      {/* Keyboard Shortcuts Help */}
      <div className="keyboard-shortcuts-hint" id="keyboard-shortcuts-hint">
        <div className="shortcut">
          <span className="key">Ctrl+N</span> New transaction
        </div>
        <div className="shortcut">
          <span className="key">Ctrl+F</span> Search
        </div>
        <div className="shortcut">
          <span className="key">C</span> Toggle cleared status
        </div>
        <div className="shortcut">
          <span className="key">Delete</span> Delete selected
        </div>
        <div className="shortcut">
          <span className="key">Esc</span> Clear selection
        </div>
      </div>

      {/* Toast Notifications */}
      <ToastContainer toasts={toasts} onDismiss={removeToast} />
    </div>
  );
};

export default LedgerTable;