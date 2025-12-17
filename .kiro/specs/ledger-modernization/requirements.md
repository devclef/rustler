# Requirements Document

## Introduction

This document outlines the requirements for modernizing the ledger experience in Rustler to align with best practices from YNAB (You Need A Budget) and Actual Budget. The goal is to improve the double-entry accounting implementation and create a more intuitive, efficient ledger interface that makes transaction entry and management seamless.

## Glossary

- **Ledger**: The transaction register view for a specific account showing all transactions affecting that account
- **Transaction**: A financial record representing money movement between accounts in a double-entry system
- **Payee**: The entity (person, business, or account) that receives or sends money in a transaction
- **Category**: A classification for spending or income used for budgeting and reporting
- **Inflow**: Money coming into an account (positive balance change)
- **Outflow**: Money leaving an account (negative balance change)
- **Transfer**: A transaction between two tracked accounts within the system
- **Split Transaction**: A single transaction divided into multiple categories or payees
- **Reconciliation**: The process of matching transactions with bank statements
- **Running Balance**: The cumulative account balance after each transaction in chronological order
- **Double-Entry Accounting**: An accounting system where every transaction affects at least two accounts with equal and opposite effects

## Requirements

### Requirement 1

**User Story:** As a user, I want a clean, keyboard-friendly ledger interface, so that I can quickly enter and edit transactions without reaching for the mouse.

#### Acceptance Criteria

1. WHEN a user opens an account ledger THEN the system SHALL display a table with inline editing capabilities for all transaction fields
2. WHEN a user presses Tab or Enter in an editable field THEN the system SHALL move focus to the next logical field in the transaction row
3. WHEN a user presses Escape in an editable field THEN the system SHALL cancel the current edit and restore the original value
4. WHEN a user clicks on any transaction field THEN the system SHALL make that field editable without requiring a separate edit button
5. WHEN a user completes editing a field THEN the system SHALL save the change immediately and provide visual feedback

### Requirement 2

**User Story:** As a user, I want to add new transactions directly in the ledger table, so that I can maintain my workflow without switching to a separate form.

#### Acceptance Criteria

1. WHEN a user views an account ledger THEN the system SHALL display an empty row at the top of the transaction table for new transaction entry
2. WHEN a user enters data in the new transaction row and presses Enter THEN the system SHALL create the transaction and clear the row for the next entry
3. WHEN a user enters data in the new transaction row THEN the system SHALL validate required fields before allowing submission
4. WHEN a new transaction is created THEN the system SHALL insert it into the ledger at the appropriate chronological position
5. WHEN a user tabs through the new transaction row THEN the system SHALL move focus through fields in a logical order: date, payee, category, outflow, inflow

### Requirement 3

**User Story:** As a user, I want a unified payee field instead of separate source/destination fields, so that I can understand transactions from the perspective of the current account.

#### Acceptance Criteria

1. WHEN viewing a transaction in an account ledger THEN the system SHALL display a single payee field showing the other party in the transaction
2. WHEN the current account is the source THEN the system SHALL display the destination account or payee name in the payee field
3. WHEN the current account is the destination THEN the system SHALL display the source account or payee name in the payee field
4. WHEN a user edits the payee field THEN the system SHALL update the appropriate source or destination account based on transaction direction
5. WHEN a user types in the payee field THEN the system SHALL provide autocomplete suggestions from existing accounts and payees

### Requirement 4

**User Story:** As a user, I want separate inflow and outflow columns instead of signed amounts, so that I can easily see money coming in versus going out.

#### Acceptance Criteria

1. WHEN viewing the ledger THEN the system SHALL display separate columns for inflow and outflow amounts
2. WHEN a transaction represents money leaving the account THEN the system SHALL display the amount in the outflow column and leave inflow empty
3. WHEN a transaction represents money entering the account THEN the system SHALL display the amount in the inflow column and leave outflow empty
4. WHEN a user enters an amount in the outflow column THEN the system SHALL create a transaction with the current account as source
5. WHEN a user enters an amount in the inflow column THEN the system SHALL create a transaction with the current account as destination

### Requirement 5

**User Story:** As a user, I want the running balance to update immediately as I edit transactions, so that I can see the impact of changes in real-time.

#### Acceptance Criteria

1. WHEN a transaction amount is modified THEN the system SHALL recalculate running balances for all subsequent transactions immediately
2. WHEN a transaction date is changed THEN the system SHALL reorder transactions chronologically and recalculate all running balances
3. WHEN a new transaction is added THEN the system SHALL insert it in chronological order and update running balances for all affected transactions
4. WHEN a transaction is deleted THEN the system SHALL recalculate running balances for all subsequent transactions
5. WHEN the ledger loads THEN the system SHALL display the current account balance at the top and calculate running balances for all visible transactions

### Requirement 6

**User Story:** As a user, I want smart autocomplete for payees and categories, so that I can enter transactions quickly with consistent data.

#### Acceptance Criteria

1. WHEN a user types in the payee field THEN the system SHALL display a dropdown of matching accounts and external payees
2. WHEN a user selects a payee from autocomplete THEN the system SHALL auto-fill the category based on the most recent transaction with that payee
3. WHEN a user types in the category field THEN the system SHALL display a dropdown of matching categories
4. WHEN a user types a new payee name THEN the system SHALL create a new external account automatically upon transaction save
5. WHEN a user types a new category name THEN the system SHALL create the new category automatically upon transaction save

### Requirement 7

**User Story:** As a user, I want to identify transfers between my accounts clearly, so that I can distinguish them from regular expenses and income.

#### Acceptance Criteria

1. WHEN a transaction involves two tracked accounts THEN the system SHALL display the other account name in the payee field with a transfer indicator
2. WHEN viewing a transfer in the ledger THEN the system SHALL display a visual indicator (such as an icon or label) that distinguishes it from regular transactions
3. WHEN a user creates a transfer THEN the system SHALL automatically create the corresponding entry in the destination account
4. WHEN a user edits one side of a transfer THEN the system SHALL update the corresponding entry in the other account automatically
5. WHEN a user deletes one side of a transfer THEN the system SHALL delete the corresponding entry in the other account automatically

### Requirement 8

**User Story:** As a user, I want to clear or reconcile transactions, so that I can match my ledger with bank statements.

#### Acceptance Criteria

1. WHEN viewing a transaction in the ledger THEN the system SHALL display a cleared status indicator (uncleared, cleared, or reconciled)
2. WHEN a user clicks the cleared status indicator THEN the system SHALL cycle through states: uncleared → cleared → reconciled
3. WHEN a transaction is marked as cleared THEN the system SHALL update the cleared balance displayed in the account header
4. WHEN a transaction is marked as reconciled THEN the system SHALL prevent editing of the amount and date fields
5. WHEN viewing the account header THEN the system SHALL display both the current balance and the cleared balance

### Requirement 9

**User Story:** As a user, I want to see visual feedback for transaction states, so that I can quickly identify pending, cleared, and reconciled transactions.

#### Acceptance Criteria

1. WHEN a transaction is uncleared THEN the system SHALL display it with a distinct visual style (such as lighter text or an icon)
2. WHEN a transaction is cleared THEN the system SHALL display it with a checkmark or similar indicator
3. WHEN a transaction is reconciled THEN the system SHALL display it with a locked indicator and distinct styling
4. WHEN a transaction is scheduled for the future THEN the system SHALL display it with a distinct visual style indicating it is pending
5. WHEN hovering over a transaction row THEN the system SHALL highlight the entire row for better visibility

### Requirement 10

**User Story:** As a user, I want the ledger to load and scroll smoothly with thousands of transactions, so that I can access my complete transaction history without performance issues.

#### Acceptance Criteria

1. WHEN the ledger contains more than 100 transactions THEN the system SHALL implement virtual scrolling to render only visible rows
2. WHEN a user scrolls through the ledger THEN the system SHALL load additional transactions dynamically without full page reloads
3. WHEN the ledger is loading additional transactions THEN the system SHALL display a loading indicator
4. WHEN a user searches or filters transactions THEN the system SHALL update the visible results within 500 milliseconds
5. WHEN the ledger renders THEN the system SHALL maintain smooth 60fps scrolling performance with up to 10,000 transactions

### Requirement 11

**User Story:** As a user, I want to search and filter transactions in the ledger, so that I can quickly find specific transactions.

#### Acceptance Criteria

1. WHEN a user types in the search box THEN the system SHALL filter transactions in real-time matching description, payee, category, or amount
2. WHEN a user applies a date range filter THEN the system SHALL display only transactions within the specified range
3. WHEN a user filters by category THEN the system SHALL display only transactions assigned to that category
4. WHEN a user filters by cleared status THEN the system SHALL display only transactions matching the selected status
5. WHEN filters are active THEN the system SHALL display a clear indicator showing which filters are applied and allow quick removal

### Requirement 12

**User Story:** As a user, I want the double-entry accounting to be enforced correctly, so that my account balances are always accurate.

#### Acceptance Criteria

1. WHEN a transaction is created THEN the system SHALL ensure both source and destination accounts are specified
2. WHEN a transaction is created THEN the system SHALL update both the source account balance (decrease) and destination account balance (increase) by the transaction amount
3. WHEN a transaction is updated THEN the system SHALL reverse the original balance effects and apply the new balance effects atomically
4. WHEN a transaction is deleted THEN the system SHALL reverse the balance effects on both accounts
5. WHEN any balance update fails THEN the system SHALL roll back the entire transaction to maintain data consistency

### Requirement 13

**User Story:** As a user, I want to bulk edit multiple transactions, so that I can efficiently categorize or modify groups of transactions.

#### Acceptance Criteria

1. WHEN a user selects multiple transactions using checkboxes THEN the system SHALL display a bulk edit toolbar
2. WHEN a user applies a category change in bulk edit THEN the system SHALL update all selected transactions with the new category
3. WHEN a user applies a cleared status change in bulk edit THEN the system SHALL update all selected transactions with the new status
4. WHEN a user confirms bulk changes THEN the system SHALL apply all changes atomically and provide feedback on success or failure
5. WHEN a user cancels bulk edit THEN the system SHALL deselect all transactions and hide the bulk edit toolbar

### Requirement 14

**User Story:** As a user, I want keyboard shortcuts for common ledger actions, so that I can work more efficiently.

#### Acceptance Criteria

1. WHEN a user presses Ctrl+N (or Cmd+N on Mac) THEN the system SHALL focus the new transaction row
2. WHEN a user presses Ctrl+F (or Cmd+F on Mac) THEN the system SHALL focus the search box
3. WHEN a user presses Delete on a selected transaction THEN the system SHALL prompt for confirmation and delete the transaction
4. WHEN a user presses C on a selected transaction THEN the system SHALL toggle the cleared status
5. WHEN a user presses Escape THEN the system SHALL clear any active selection or cancel the current edit

### Requirement 15

**User Story:** As a user, I want the ledger UI to be responsive, so that I can manage transactions on mobile devices.

#### Acceptance Criteria

1. WHEN viewing the ledger on a mobile device THEN the system SHALL display a card-based layout instead of a table
2. WHEN viewing a transaction card on mobile THEN the system SHALL display all essential fields in a readable format
3. WHEN a user taps a transaction card on mobile THEN the system SHALL expand it to show all fields for editing
4. WHEN a user swipes left on a transaction card THEN the system SHALL reveal quick actions (edit, delete, clear)
5. WHEN entering a new transaction on mobile THEN the system SHALL provide a full-screen form optimized for touch input
