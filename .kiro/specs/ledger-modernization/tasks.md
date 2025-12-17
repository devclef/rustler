# Implementation Plan

- [x] 1. Enhance backend data models and database schema
  - Add `cleared_status` enum type to database (uncleared, cleared, reconciled)
  - Add `cleared_status` column to transactions table with default 'uncleared'
  - Add `cleared_balance` column to accounts table with default 0
  - Create database migration for schema changes
  - Update Rust Transaction model to include `cleared_status` field
  - Update Rust Account model to include `cleared_balance` field
  - _Requirements: 8.1, 8.3, 8.5_

- [ ]* 1.1 Write property test for cleared status enum
  - **Property 42: Transaction creation updates both account balances**
  - **Validates: Requirements 12.2**

- [ ] 2. Implement cleared balance tracking in transaction service
  - [ ] 2.1 Update transaction creation to calculate cleared balance
    - When creating a transaction, if cleared_status is 'cleared' or 'reconciled', update both account cleared balances
    - Maintain double-entry invariant for cleared balances
    - _Requirements: 8.3, 12.2_

  - [ ]* 2.2 Write property test for cleared balance updates
    - **Property 30: Cleared status updates cleared balance**
    - **Validates: Requirements 8.3**

  - [ ] 2.3 Update transaction update to recalculate cleared balances
    - Reverse original cleared balance effects if transaction was cleared/reconciled
    - Apply new cleared balance effects based on new cleared status
    - _Requirements: 8.3, 12.3_

  - [ ]* 2.4 Write property test for cleared balance recalculation
    - **Property 43: Transaction update reverses and reapplies balance effects**
    - **Validates: Requirements 12.3**

  - [ ] 2.5 Update transaction deletion to reverse cleared balance effects
    - When deleting a cleared/reconciled transaction, reverse cleared balance effects
    - _Requirements: 8.3, 12.4_

  - [ ]* 2.6 Write property test for deletion balance reversal
    - **Property 44: Transaction deletion reverses balance effects**
    - **Validates: Requirements 12.4**

- [ ] 3. Add cleared status API endpoint
  - Create PATCH `/api/transactions/:id/cleared-status` endpoint
  - Validate cleared status transitions (allow any transition for now)
  - Update transaction cleared_status and recalculate cleared balances
  - Return updated transaction with new cleared status
  - _Requirements: 8.2, 8.3_

- [ ]* 3.1 Write property test for cleared status cycling
  - **Property 29: Cleared status cycles through states**
  - **Validates: Requirements 8.2**

- [ ] 4. Enhance ledger API endpoint
  - [ ] 4.1 Modify GET `/api/accounts/:id/ledger` endpoint
    - Add pagination parameters (page, limit)
    - Add search parameter for filtering
    - Return transactions with computed `isTransfer` field
    - Include `currentBalance` and `clearedBalance` in response
    - _Requirements: 5.5, 8.5, 10.2, 11.1_

  - [ ] 4.2 Add transaction perspective transformation
    - Compute payee field based on account perspective (show other party)
    - Compute inflow/outflow based on transaction direction
    - Mark transfers between tracked accounts with `isTransfer: true`
    - _Requirements: 3.1, 3.2, 3.3, 4.2, 4.3, 7.1_

  - [ ]* 4.3 Write property test for payee perspective
    - **Property 8: Payee field shows other party**
    - **Validates: Requirements 3.1, 3.2, 3.3**

  - [ ]* 4.4 Write property test for inflow/outflow display
    - **Property 11: Outflow displays for money leaving account**
    - **Property 12: Inflow displays for money entering account**
    - **Validates: Requirements 4.2, 4.3**

- [ ] 5. Implement payee autocomplete API
  - Create GET `/api/payees/autocomplete` endpoint
  - Query accounts table for matching account names
  - Query transactions for unique external payee names (from destination_name)
  - Return combined list of accounts and external payees
  - _Requirements: 3.5, 6.1_

- [ ]* 5.1 Write property test for autocomplete matching
  - **Property 10: Payee autocomplete suggests existing entities**
  - **Validates: Requirements 3.5**

- [ ] 6. Implement category auto-fill API
  - Create GET `/api/payees/:name/last-category` endpoint
  - Query most recent transaction with matching payee (source or destination)
  - Return category_id and category name from that transaction
  - Handle case where no previous transaction exists
  - _Requirements: 6.2_

- [ ]* 6.1 Write property test for category auto-fill
  - **Property 19: Payee selection auto-fills category**
  - **Validates: Requirements 6.2**

- [ ] 7. Implement bulk update API
  - Create POST `/api/transactions/bulk-update` endpoint
  - Accept array of transaction IDs and partial update object
  - Update all specified transactions in a database transaction
  - Return count of updated transactions and any failures
  - _Requirements: 13.2, 13.3, 13.4_

- [ ]* 7.1 Write property test for bulk updates
  - **Property 45: Bulk category update applies to all selected**
  - **Property 46: Bulk cleared status update applies to all selected**
  - **Property 47: Bulk update applies all changes**
  - **Validates: Requirements 13.2, 13.3, 13.4**

- [ ] 8. Checkpoint - Ensure all backend tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Create LedgerTransaction TypeScript interface
  - Define LedgerTransaction interface with computed fields
  - Add types for ClearedStatus enum
  - Add types for ledger API responses
  - Update api.ts service with new ledger endpoint
  - _Requirements: 3.1, 4.1, 8.1_

- [ ] 10. Implement running balance calculation utility
  - [ ] 10.1 Create calculateRunningBalances function
    - Accept array of transactions and current account balance
    - Sort transactions by date (newest first)
    - Calculate running balance for each transaction working backwards
    - Return map of transaction ID to running balance
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [ ]* 10.2 Write property test for running balance calculation
    - **Property 15: Amount modification recalculates subsequent running balances**
    - **Property 16: Date change reorders and recalculates balances**
    - **Property 17: New transaction insertion updates affected balances**
    - **Property 18: Transaction deletion recalculates subsequent balances**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4**

- [ ] 11. Create PayeeAutocomplete component
  - [ ] 11.1 Build autocomplete dropdown component
    - Fetch suggestions from `/api/payees/autocomplete` as user types
    - Display accounts with account type indicator
    - Display external payees with distinct styling
    - Handle selection and call onChange callback
    - _Requirements: 3.5, 6.1_

  - [ ] 11.2 Implement category auto-fill on payee selection
    - When payee is selected, fetch last category from API
    - Auto-fill category field if previous category exists
    - _Requirements: 6.2_

  - [ ]* 11.3 Write property test for payee autocomplete
    - **Property 10: Payee autocomplete suggests existing entities**
    - **Property 19: Payee selection auto-fills category**
    - **Validates: Requirements 3.5, 6.2**

- [ ] 12. Create CategoryAutocomplete component
  - Build autocomplete dropdown for categories
  - Fetch categories from existing categories API
  - Filter categories based on user input
  - Allow creating new categories on the fly
  - _Requirements: 6.3, 6.5_

- [ ]* 12.1 Write property test for category autocomplete
  - **Property 20: Category autocomplete suggests matching categories**
  - **Property 22: New category is created automatically**
  - **Validates: Requirements 6.3, 6.5**

- [ ] 13. Create TransactionRow component with inline editing
  - [ ] 13.1 Build editable transaction row
    - Display transaction fields as editable cells
    - Implement click-to-edit for all fields
    - Show cleared status indicator with click-to-cycle
    - Display inflow/outflow in separate columns
    - Show transfer indicator for transfers
    - Display running balance
    - _Requirements: 1.1, 1.4, 3.1, 4.1, 4.2, 4.3, 7.1, 7.2, 8.1, 9.1, 9.2, 9.3, 9.4_

  - [ ] 13.2 Implement keyboard navigation
    - Handle Tab/Enter to move to next field
    - Handle Escape to cancel edit
    - Implement field focus order: date → payee → category → outflow → inflow
    - _Requirements: 1.2, 1.3_

  - [ ]* 13.3 Write property test for keyboard navigation
    - **Property 1: Keyboard navigation moves focus sequentially**
    - **Property 2: Escape key restores original value**
    - **Validates: Requirements 1.2, 1.3**

  - [ ] 13.4 Implement immediate save on edit completion
    - Save field changes immediately when focus leaves field
    - Show visual feedback (brief highlight) on successful save
    - Handle save errors gracefully
    - _Requirements: 1.5_

  - [ ]* 13.5 Write property test for immediate save
    - **Property 4: Field edits save immediately**
    - **Validates: Requirements 1.5**

  - [ ] 13.6 Implement reconciled transaction restrictions
    - Disable amount and date editing for reconciled transactions
    - Show tooltip explaining why fields are disabled
    - _Requirements: 8.4_

  - [ ]* 13.7 Write property test for reconciled restrictions
    - **Property 31: Reconciled transactions prevent amount/date edits**
    - **Validates: Requirements 8.4**

- [ ] 14. Create NewTransactionRow component
  - [ ] 14.1 Build new transaction input row
    - Display empty row at top of ledger table
    - Include all transaction fields (date, payee, category, outflow, inflow)
    - Use PayeeAutocomplete and CategoryAutocomplete components
    - Default date to today
    - _Requirements: 2.1, 2.5_

  - [ ] 14.2 Implement transaction creation on Enter
    - Validate required fields before submission
    - Create transaction via API
    - Clear row after successful creation
    - Focus date field for next transaction
    - _Requirements: 2.2, 2.3_

  - [ ]* 14.3 Write property test for transaction creation
    - **Property 5: New transaction creation clears input row**
    - **Property 6: Required field validation prevents submission**
    - **Property 7: Transactions inserted in chronological order**
    - **Validates: Requirements 2.2, 2.3, 2.4**

  - [ ] 14.3 Implement inflow/outflow logic
    - When outflow is entered, create transaction with current account as source
    - When inflow is entered, create transaction with current account as destination
    - Prevent entering both inflow and outflow simultaneously
    - _Requirements: 4.4, 4.5_

  - [ ]* 14.4 Write property test for inflow/outflow creation
    - **Property 13: Outflow entry creates transaction with current account as source**
    - **Property 14: Inflow entry creates transaction with current account as destination**
    - **Validates: Requirements 4.4, 4.5**

- [ ] 15. Create LedgerTable component
  - [ ] 15.1 Build main ledger container
    - Display account name and balances in header
    - Show current balance and cleared balance
    - Render NewTransactionRow at top
    - Render list of TransactionRow components
    - Implement virtual scrolling for performance
    - _Requirements: 5.5, 8.5, 10.1, 10.2_

  - [ ] 15.2 Implement search and filter UI
    - Add search input box
    - Add date range filter inputs
    - Add category filter dropdown
    - Add cleared status filter dropdown
    - Show active filter indicators
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_

  - [ ]* 15.3 Write property test for filtering
    - **Property 37: Search filters transactions by multiple fields**
    - **Property 38: Date range filter shows only transactions in range**
    - **Property 39: Category filter shows only matching transactions**
    - **Property 40: Cleared status filter shows only matching transactions**
    - **Validates: Requirements 11.1, 11.2, 11.3, 11.4**

  - [ ] 15.4 Implement transaction selection
    - Add checkbox column for selecting transactions
    - Track selected transaction IDs in state
    - Add "select all" checkbox in header
    - _Requirements: 13.1_

  - [ ] 15.5 Implement running balance updates
    - Recalculate running balances when transactions change
    - Update running balances when filters change
    - Ensure running balances are always accurate
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [ ] 16. Create BulkEditToolbar component
  - [ ] 16.1 Build bulk edit toolbar
    - Show toolbar when transactions are selected
    - Display count of selected transactions
    - Add category bulk edit dropdown
    - Add cleared status bulk edit dropdown
    - Add "Apply" and "Cancel" buttons
    - _Requirements: 13.1, 13.5_

  - [ ] 16.2 Implement bulk update operations
    - Call bulk update API with selected IDs and changes
    - Show loading state during update
    - Show success/error feedback
    - Clear selection after successful update
    - _Requirements: 13.2, 13.3, 13.4_

  - [ ]* 16.3 Write property test for bulk operations
    - **Property 45: Bulk category update applies to all selected**
    - **Property 46: Bulk cleared status update applies to all selected**
    - **Validates: Requirements 13.2, 13.3**

- [ ] 17. Implement keyboard shortcuts
  - Add global keyboard event listener
  - Implement Ctrl/Cmd+N to focus new transaction row
  - Implement Ctrl/Cmd+F to focus search box
  - Implement Delete key to delete selected transaction
  - Implement C key to toggle cleared status
  - Implement Escape to clear selection
  - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5_

- [ ] 18. Implement transfer detection and display
  - [ ] 18.1 Add transfer indicator to TransactionRow
    - Check if transaction has `isTransfer: true`
    - Display transfer icon/label in payee field
    - Style transfer rows distinctly
    - _Requirements: 7.1, 7.2_

  - [ ]* 18.2 Write property test for transfer display
    - **Property 23: Transfer displays other account with indicator**
    - **Property 24: Transfer has visual indicator**
    - **Validates: Requirements 7.1, 7.2**

  - [ ] 18.3 Implement transfer synchronization
    - When editing a transfer, update both sides
    - When deleting a transfer, delete both sides
    - Show warning when editing transfers
    - _Requirements: 7.3, 7.4, 7.5_

  - [ ]* 18.4 Write property test for transfer synchronization
    - **Property 25: Transfer creation creates both entries**
    - **Property 26: Transfer edit updates both sides**
    - **Property 27: Transfer deletion removes both sides**
    - **Validates: Requirements 7.3, 7.4, 7.5**

- [ ] 19. Add visual styling for transaction states
  - Style uncleared transactions with lighter text
  - Add checkmark icon for cleared transactions
  - Add lock icon for reconciled transactions
  - Style future transactions with distinct color
  - Add hover effect to highlight rows
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

- [ ]* 19.1 Write property test for visual states
  - **Property 32: Uncleared transactions have distinct styling**
  - **Property 33: Cleared transactions show indicator**
  - **Property 34: Reconciled transactions show locked indicator**
  - **Property 35: Future transactions have pending style**
  - **Validates: Requirements 9.1, 9.2, 9.3, 9.4**

- [ ] 20. Implement mobile responsive layout
  - Create card-based layout for mobile viewports
  - Implement expandable transaction cards
  - Add swipe gestures for quick actions
  - Create full-screen new transaction form for mobile
  - Test on various mobile screen sizes
  - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5_

- [ ] 21. Optimize performance with virtual scrolling
  - Implement react-window or similar library for virtual scrolling
  - Render only visible transaction rows
  - Implement dynamic loading on scroll
  - Test with 10,000+ transactions
  - _Requirements: 10.1, 10.2, 10.3_

- [ ]* 21.1 Write property test for scroll loading
  - **Property 36: Scroll loads additional transactions**
  - **Validates: Requirements 10.2**

- [ ] 22. Add loading states and error handling
  - Show loading spinner during API calls
  - Display error messages for failed operations
  - Implement retry logic for failed requests
  - Add optimistic UI updates for better perceived performance
  - _Requirements: 10.3_

- [ ] 23. Update existing AccountLedger component
  - Replace old AccountLedger with new LedgerTable component
  - Remove old form-based transaction entry
  - Remove old separate withdrawal/deposit columns
  - Migrate any remaining functionality to new components
  - _Requirements: All_

- [ ] 24. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 25. Integration testing and bug fixes
  - Test complete transaction creation flow
  - Test transaction editing and deletion
  - Test transfer creation and synchronization
  - Test bulk operations
  - Test search and filtering
  - Test keyboard shortcuts
  - Test mobile responsive layout
  - Fix any bugs discovered during testing
  - _Requirements: All_
