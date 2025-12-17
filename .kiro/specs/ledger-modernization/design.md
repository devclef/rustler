# Ledger Modernization Design Document

## Overview

This design document outlines the architecture and implementation approach for modernizing the Rustler ledger experience to align with best practices from YNAB and Actual Budget. The modernization focuses on three key areas:

1. **Improved Double-Entry Accounting**: Ensuring robust, consistent double-entry bookkeeping with proper validation and atomic operations
2. **Modern Ledger UI**: Creating an intuitive, keyboard-friendly interface with inline editing and smart autocomplete
3. **Performance Optimization**: Implementing virtual scrolling and efficient rendering for large transaction sets

The design maintains backward compatibility with existing data while introducing new features like cleared/reconciled status, improved transfer handling, and a unified payee field.

## Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Frontend (React)                         │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────────┐  ┌──────────────────┐                │
│  │  LedgerTable     │  │  TransactionRow  │                │
│  │  Component       │  │  Component       │                │
│  └────────┬─────────┘  └────────┬─────────┘                │
│           │                     │                            │
│  ┌────────▼─────────────────────▼─────────┐                │
│  │     LedgerState Management              │                │
│  │  (Running Balance, Filters, Selection)  │                │
│  └────────┬─────────────────────────────────┘               │
│           │                                                  │
│  ┌────────▼─────────────────────────────────┐               │
│  │     API Service Layer                    │               │
│  └────────┬─────────────────────────────────┘               │
└───────────┼──────────────────────────────────────────────────┘
            │
            │ HTTP/REST
            │
┌───────────▼──────────────────────────────────────────────────┐
│                     Backend (Rust)                            │
├──────────────────────────────────────────────────────────────┤
│  ┌──────────────────┐  ┌──────────────────┐                 │
│  │  Transaction     │  │  Account         │                 │
│  │  Routes          │  │  Routes          │                 │
│  └────────┬─────────┘  └────────┬─────────┘                 │
│           │                     │                            │
│  ┌────────▼─────────────────────▼─────────┐                 │
│  │     Transaction Service                 │                 │
│  │  (Double-Entry Logic, Validation)       │                 │
│  └────────┬─────────────────────────────────┘                │
│           │                                                   │
│  ┌────────▼─────────────────────────────────┐                │
│  │     Database Layer (PostgreSQL)          │                │
│  │  (Transactions, Accounts, Categories)    │                │
│  └──────────────────────────────────────────┘                │
└──────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

**Frontend Components:**
- **LedgerTable**: Main container component managing ledger state, filters, and virtual scrolling
- **TransactionRow**: Individual transaction row with inline editing capabilities
- **NewTransactionRow**: Dedicated row for creating new transactions
- **PayeeAutocomplete**: Smart autocomplete for payee selection with category auto-fill
- **CategoryAutocomplete**: Autocomplete for category selection
- **BulkEditToolbar**: Toolbar for bulk operations on selected transactions

**Backend Services:**
- **TransactionService**: Core business logic for transaction CRUD operations with double-entry enforcement
- **AccountService**: Account management and balance calculations
- **CategoryService**: Category management and auto-creation
- **ReconciliationService**: New service for handling cleared/reconciled status

## Components and Interfaces

### Data Models

#### Enhanced Transaction Model

```rust
pub struct Transaction {
    pub id: Uuid,
    pub source_account_id: Uuid,
    pub destination_account_id: Uuid,
    pub description: String,
    pub amount: f64,  // Always positive; direction determined by source/destination
    pub category_id: Option<Uuid>,
    pub budget_id: Option<Uuid>,
    pub transaction_date: DateTime<Utc>,
    pub cleared_status: ClearedStatus,  // NEW
    pub is_transfer: bool,  // NEW - computed field
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

pub enum ClearedStatus {
    Uncleared,
    Cleared,
    Reconciled,
}
```

#### Account Model Enhancement

```rust
pub struct Account {
    pub id: Uuid,
    pub name: String,
    pub account_type: AccountType,
    pub balance: f64,
    pub cleared_balance: f64,  // NEW
    pub currency: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}
```

#### Frontend Transaction View Model

```typescript
interface LedgerTransaction {
  id: string;
  date: Date;
  payee: string;  // Computed from source/destination based on perspective
  category: string;
  clearedStatus: 'uncleared' | 'cleared' | 'reconciled';
  outflow: number | null;  // Shown when money leaves account
  inflow: number | null;   // Shown when money enters account
  runningBalance: number;  // Computed on frontend
  isTransfer: boolean;
  memo: string;
}
```

### API Endpoints

#### New/Modified Endpoints

```
GET    /api/accounts/:id/ledger?page=1&limit=50&search=query
  - Returns paginated transactions with computed fields for ledger view
  - Includes running balance calculations
  - Response: { transactions: LedgerTransaction[], totalCount: number, currentBalance: number, clearedBalance: number }

PATCH  /api/transactions/:id/cleared-status
  - Updates cleared status of a transaction
  - Request: { status: 'uncleared' | 'cleared' | 'reconciled' }
  - Response: Updated transaction

POST   /api/transactions/bulk-update
  - Bulk updates multiple transactions
  - Request: { transactionIds: string[], updates: Partial<Transaction> }
  - Response: { updated: number, failed: string[] }

GET    /api/payees/autocomplete?query=search
  - Returns matching accounts and external payees
  - Response: { accounts: Account[], externalPayees: string[] }

GET    /api/payees/:name/last-category
  - Returns the most recent category used with a payee
  - Response: { categoryId: string, categoryName: string }
```

### Frontend State Management

```typescript
interface LedgerState {
  transactions: LedgerTransaction[];
  currentBalance: number;
  clearedBalance: number;
  filters: {
    search: string;
    dateRange: { start: Date | null; end: Date | null };
    category: string | null;
    clearedStatus: ClearedStatus | null;
  };
  selection: Set<string>;  // Selected transaction IDs
  editingCell: { transactionId: string; field: string } | null;
  isLoading: boolean;
  hasMore: boolean;
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Keyboard navigation moves focus sequentially

*For any* editable field in a transaction row, pressing Tab or Enter should move focus to the next logical field in the sequence (date → payee → category → outflow → inflow).

**Validates: Requirements 1.2**

### Property 2: Escape key restores original value

*For any* field being edited, pressing Escape should cancel the edit and restore the field to its original value before editing began.

**Validates: Requirements 1.3**

### Property 3: Click makes field editable

*For any* transaction field that is not reconciled, clicking on it should make it editable without requiring a separate edit button.

**Validates: Requirements 1.4**

### Property 4: Field edits save immediately

*For any* completed field edit, the system should save the change immediately and provide visual feedback (such as a brief highlight or checkmark).

**Validates: Requirements 1.5**

### Property 5: New transaction creation clears input row

*For any* valid new transaction entered in the new transaction row, pressing Enter should create the transaction and clear all fields in the row for the next entry.

**Validates: Requirements 2.2**

### Property 6: Required field validation prevents submission

*For any* new transaction submission attempt, if required fields (date, payee or description, and either inflow or outflow) are missing, the system should prevent submission and indicate which fields are required.

**Validates: Requirements 2.3**

### Property 7: Transactions inserted in chronological order

*For any* new transaction with a given date, the system should insert it into the ledger at the correct chronological position relative to other transactions.

**Validates: Requirements 2.4**

### Property 8: Payee field shows other party

*For any* transaction viewed in an account ledger, the payee field should display the account or payee name of the other party (destination if current account is source, source if current account is destination).

**Validates: Requirements 3.1, 3.2, 3.3**

### Property 9: Payee edit updates correct account

*For any* payee field edit, the system should update the appropriate source or destination account based on the transaction direction (if current account is source, update destination; if current account is destination, update source).

**Validates: Requirements 3.4**

### Property 10: Payee autocomplete suggests existing entities

*For any* text entered in the payee field, the autocomplete dropdown should display matching accounts and external payees from the system.

**Validates: Requirements 3.5**

### Property 11: Outflow displays for money leaving account

*For any* transaction where money leaves the current account (current account is source), the amount should be displayed in the outflow column and the inflow column should be empty.

**Validates: Requirements 4.2**

### Property 12: Inflow displays for money entering account

*For any* transaction where money enters the current account (current account is destination), the amount should be displayed in the inflow column and the outflow column should be empty.

**Validates: Requirements 4.3**

### Property 13: Outflow entry creates transaction with current account as source

*For any* amount entered in the outflow column of a new transaction, the created transaction should have the current account as the source account.

**Validates: Requirements 4.4**

### Property 14: Inflow entry creates transaction with current account as destination

*For any* amount entered in the inflow column of a new transaction, the created transaction should have the current account as the destination account.

**Validates: Requirements 4.5**

### Property 15: Amount modification recalculates subsequent running balances

*For any* transaction amount modification, all running balances for transactions after that date should be recalculated to reflect the change.

**Validates: Requirements 5.1**

### Property 16: Date change reorders and recalculates balances

*For any* transaction date modification, the transaction should be moved to its new chronological position and all running balances should be recalculated.

**Validates: Requirements 5.2**

### Property 17: New transaction insertion updates affected balances

*For any* new transaction added, it should be inserted in chronological order and running balances for all transactions at or after that date should be recalculated.

**Validates: Requirements 5.3**

### Property 18: Transaction deletion recalculates subsequent balances

*For any* transaction deletion, all running balances for transactions after the deleted transaction's date should be recalculated.

**Validates: Requirements 5.4**

### Property 19: Payee selection auto-fills category

*For any* payee selected from autocomplete, if that payee has been used in previous transactions, the category field should be auto-filled with the category from the most recent transaction with that payee.

**Validates: Requirements 6.2**

### Property 20: Category autocomplete suggests matching categories

*For any* text entered in the category field, the autocomplete dropdown should display matching categories from the system.

**Validates: Requirements 6.3**

### Property 21: New payee creates external account

*For any* new payee name entered that doesn't match an existing account, the system should automatically create a new external account with that name when the transaction is saved.

**Validates: Requirements 6.4**

### Property 22: New category is created automatically

*For any* new category name entered that doesn't match an existing category, the system should automatically create the new category when the transaction is saved.

**Validates: Requirements 6.5**

### Property 23: Transfer displays other account with indicator

*For any* transaction between two tracked accounts, the payee field should display the other account's name with a visual transfer indicator (such as an icon or label).

**Validates: Requirements 7.1**

### Property 24: Transfer has visual indicator

*For any* transfer transaction (between two tracked accounts), the ledger should display a visual indicator that distinguishes it from regular transactions.

**Validates: Requirements 7.2**

### Property 25: Transfer creation creates both entries

*For any* transfer created between two accounts, the system should create corresponding transaction entries in both accounts with matching amounts and opposite directions.

**Validates: Requirements 7.3**

### Property 26: Transfer edit updates both sides

*For any* transfer transaction edit (amount, date, or category), the system should update the corresponding entry in the other account to maintain consistency.

**Validates: Requirements 7.4**

### Property 27: Transfer deletion removes both sides

*For any* transfer transaction deletion, the system should delete the corresponding entry in the other account as well.

**Validates: Requirements 7.5**

### Property 28: Transaction displays cleared status

*For any* transaction in the ledger, a cleared status indicator should be visible showing whether it is uncleared, cleared, or reconciled.

**Validates: Requirements 8.1**

### Property 29: Cleared status cycles through states

*For any* cleared status indicator click, the status should cycle through the states in order: uncleared → cleared → reconciled → uncleared.

**Validates: Requirements 8.2**

### Property 30: Cleared status updates cleared balance

*For any* transaction marked as cleared or uncleared, the cleared balance displayed in the account header should be updated to reflect the change.

**Validates: Requirements 8.3**

### Property 31: Reconciled transactions prevent amount/date edits

*For any* transaction marked as reconciled, the amount and date fields should not be editable (attempts to edit should be prevented or show a warning).

**Validates: Requirements 8.4**

### Property 32: Uncleared transactions have distinct styling

*For any* uncleared transaction, the row should be displayed with a distinct visual style (such as lighter text or a specific icon) to differentiate it from cleared transactions.

**Validates: Requirements 9.1**

### Property 33: Cleared transactions show indicator

*For any* cleared transaction, the row should display a checkmark or similar indicator to show its cleared status.

**Validates: Requirements 9.2**

### Property 34: Reconciled transactions show locked indicator

*For any* reconciled transaction, the row should display a locked indicator and distinct styling to show it cannot be easily modified.

**Validates: Requirements 9.3**

### Property 35: Future transactions have pending style

*For any* transaction with a date in the future, the row should be displayed with a distinct visual style indicating it is a pending/scheduled transaction.

**Validates: Requirements 9.4**

### Property 36: Scroll loads additional transactions

*For any* scroll action that reaches near the bottom of the visible transactions, the system should load additional transactions dynamically without a full page reload.

**Validates: Requirements 10.2**

### Property 37: Search filters transactions by multiple fields

*For any* search query entered, the system should filter transactions to show only those matching the query in description, payee, category, or amount fields.

**Validates: Requirements 11.1**

### Property 38: Date range filter shows only transactions in range

*For any* date range filter applied, the system should display only transactions with dates within the specified start and end dates (inclusive).

**Validates: Requirements 11.2**

### Property 39: Category filter shows only matching transactions

*For any* category filter applied, the system should display only transactions assigned to that specific category.

**Validates: Requirements 11.3**

### Property 40: Cleared status filter shows only matching transactions

*For any* cleared status filter applied, the system should display only transactions with the selected cleared status (uncleared, cleared, or reconciled).

**Validates: Requirements 11.4**

### Property 41: Transaction creation requires both accounts

*For any* transaction creation attempt, the system should validate that both source and destination accounts are specified before allowing the transaction to be created.

**Validates: Requirements 12.1**

### Property 42: Transaction creation updates both account balances

*For any* transaction created with amount A, the source account balance should decrease by A and the destination account balance should increase by A (maintaining the double-entry invariant: source_change + destination_change = 0).

**Validates: Requirements 12.2**

### Property 43: Transaction update reverses and reapplies balance effects

*For any* transaction update, the system should first reverse the original balance effects on both accounts, then apply the new balance effects, ensuring the operation is atomic.

**Validates: Requirements 12.3**

### Property 44: Transaction deletion reverses balance effects

*For any* transaction deletion, the system should reverse the balance effects on both the source and destination accounts (source balance increases, destination balance decreases).

**Validates: Requirements 12.4**

### Property 45: Bulk category update applies to all selected

*For any* bulk category update operation, all selected transactions should be updated with the new category value.

**Validates: Requirements 13.2**

### Property 46: Bulk cleared status update applies to all selected

*For any* bulk cleared status update operation, all selected transactions should be updated with the new cleared status value.

**Validates: Requirements 13.3**

### Property 47: Bulk update applies all changes

*For any* bulk update confirmation, all specified changes should be applied to all selected transactions.

**Validates: Requirements 13.4**

## Error Handling

### Validation Errors

1. **Missing Required Fields**: When creating or updating transactions, validate that required fields (source account, destination account, amount, date) are present
2. **Invalid Amount**: Reject transactions with zero, negative, or non-numeric amounts
3. **Same Source and Destination**: Prevent transactions where source and destination are the same account
4. **Invalid Date**: Reject transactions with invalid or malformed dates
5. **Reconciled Transaction Edit**: Prevent editing amount or date of reconciled transactions

### Double-Entry Consistency Errors

1. **Balance Update Failure**: If updating one account balance fails, roll back the entire transaction
2. **Orphaned Transaction**: Prevent creating transactions with non-existent accounts
3. **Transfer Synchronization Failure**: If updating one side of a transfer fails, roll back both sides

### User-Facing Error Messages

- **"Both source and destination accounts are required"**: When attempting to create a transaction without specifying both accounts
- **"Amount must be a positive number"**: When entering an invalid amount
- **"Cannot edit reconciled transaction"**: When attempting to edit a reconciled transaction's amount or date
- **"Transaction date is required"**: When attempting to save without a date
- **"Failed to update account balances"**: When a balance update operation fails

## Testing Strategy

### Unit Testing

Unit tests will cover:
- Individual component rendering (LedgerTable, TransactionRow, autocomplete components)
- State management functions (running balance calculation, filter application)
- API service functions (transaction CRUD, account updates)
- Validation logic (required fields, amount validation, date validation)
- Error handling paths

### Property-Based Testing

Property-based tests will be implemented using **fast-check** for TypeScript/JavaScript and **proptest** for Rust. Each test will run a minimum of 100 iterations with randomly generated inputs.

**Frontend Property Tests (fast-check):**
- Keyboard navigation sequences
- Running balance calculations with random transaction sets
- Filter combinations with random transaction data
- Autocomplete matching with random input strings
- Bulk operations on random transaction selections

**Backend Property Tests (proptest):**
- Double-entry balance invariants with random transaction amounts
- Transaction CRUD operations maintaining database consistency
- Transfer synchronization with random account pairs
- Cleared balance calculations with random cleared status changes

**Key Properties to Test:**
1. **Double-Entry Invariant**: For any transaction, source_balance_change + destination_balance_change = 0
2. **Running Balance Consistency**: For any sequence of transactions, the final running balance equals the account balance
3. **Transfer Symmetry**: For any transfer, the amounts in both accounts are equal and opposite
4. **Filter Correctness**: For any filter combination, all displayed transactions match the filter criteria
5. **Bulk Update Atomicity**: For any bulk update, either all transactions are updated or none are

### Integration Testing

Integration tests will verify:
- End-to-end transaction creation flow from UI to database
- Transfer creation and synchronization across accounts
- Bulk edit operations affecting multiple transactions
- Search and filter operations with database queries
- Cleared status updates affecting cleared balance calculations

### Performance Testing

Performance tests will measure:
- Ledger rendering time with 1,000, 5,000, and 10,000 transactions
- Virtual scrolling performance and memory usage
- Search/filter response time with large transaction sets
- Running balance calculation performance
- Bulk update operation time with varying selection sizes

Target metrics:
- Initial ledger load: < 1 second for 1,000 transactions
- Scroll rendering: 60fps maintained
- Search/filter: < 500ms response time
- Running balance calculation: < 100ms for 1,000 transactions
