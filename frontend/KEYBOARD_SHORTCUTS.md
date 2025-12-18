# Keyboard Shortcuts for Ledger Table

The LedgerTable component now supports the following keyboard shortcuts for improved productivity:

## Global Shortcuts

These shortcuts work when the ledger table is focused and no input field is being edited:

### Navigation & Focus
- **Ctrl+N** (or **Cmd+N** on Mac): Focus the new transaction row date field
- **Ctrl+F** (or **Cmd+F** on Mac): Focus the search input box

### Transaction Management
- **Delete**: Delete all selected transactions (with confirmation prompt)
- **C**: Toggle cleared status for all selected transactions (cycles through: uncleared → cleared → reconciled)
- **Escape**: Clear all transaction selections

## Implementation Details

### Event Handling
- Global keyboard event listener is attached to the document
- Shortcuts are disabled when user is typing in input fields, textareas, or contentEditable elements
- Uses `e.ctrlKey || e.metaKey` to support both Windows/Linux (Ctrl) and Mac (Cmd) modifiers

### Visual Feedback
- Search input placeholder includes "(Ctrl+F)" hint
- Selection count is displayed in the transaction count footer
- Keyboard shortcuts help panel is available (can be shown/hidden as needed)

### Accessibility
- All shortcuts follow standard conventions
- Focus management ensures keyboard navigation remains intuitive
- Confirmation dialogs for destructive actions (delete)

## Usage Examples

1. **Quick Transaction Entry**: Press Ctrl+N to immediately start entering a new transaction
2. **Search Transactions**: Press Ctrl+F to quickly search through transactions
3. **Bulk Status Update**: Select multiple transactions and press C to mark them all as cleared
4. **Bulk Delete**: Select unwanted transactions and press Delete to remove them
5. **Clear Selection**: Press Escape to deselect all transactions

## Browser Compatibility

The keyboard shortcuts work in all modern browsers and respect platform conventions (Ctrl on Windows/Linux, Cmd on Mac).