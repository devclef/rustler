import React, { useState, useRef, useEffect, type KeyboardEvent } from 'react';
import type { LedgerTransaction, ClearedStatus } from '../../services/types';
import { enhancedApi } from '../../services/enhancedApi';
import { getErrorMessage } from '../../utils/errorHandling';
import PayeeAutocomplete from '../common/PayeeAutocomplete';
import CategoryAutocomplete from '../common/CategoryAutocomplete';
import './TransactionRow.css';

interface TransactionRowProps {
  transaction: LedgerTransaction;
  accountId: string;
  onTransactionUpdate: (updatedTransaction: LedgerTransaction, optimistic?: boolean) => void;
  onTransactionDelete: (transactionId: string, optimistic?: boolean) => void;
  isSelected: boolean;
  onSelectionChange: (transactionId: string, selected: boolean) => void;
}

type EditableField = 'date' | 'payee' | 'category' | 'outflow' | 'inflow' | 'memo';

interface EditingState {
  field: EditableField;
  value: string;
  originalValue: string;
}

const TransactionRow: React.FC<TransactionRowProps> = ({
  transaction,
  accountId: _accountId, // Currently unused but may be needed for future enhancements
  onTransactionUpdate,
  onTransactionDelete,
  isSelected,
  onSelectionChange,
}) => {
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when editing starts
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  // Handle starting edit for a field
  const handleStartEdit = (field: EditableField) => {
    if (saving) return;
    
    // Don't allow editing amount/date for reconciled transactions
    if (transaction.cleared_status === 'reconciled' && (field === 'outflow' || field === 'inflow' || field === 'date')) {
      setError('Cannot edit amount or date of reconciled transactions');
      setTimeout(() => setError(null), 3000);
      return;
    }

    // Show warning for transfer edits
    if (transaction.is_transfer && (field === 'outflow' || field === 'inflow' || field === 'date' || field === 'payee')) {
      const shouldProceed = window.confirm(
        'This is a transfer between accounts. Editing this transaction will only affect this side of the transfer. ' +
        'You may need to manually update the corresponding transaction in the other account. Continue?'
      );
      if (!shouldProceed) {
        return;
      }
    }

    let initialValue = '';
    switch (field) {
      case 'date':
        initialValue = new Date(transaction.date).toISOString().split('T')[0];
        break;
      case 'payee':
        initialValue = transaction.payee;
        break;
      case 'category':
        initialValue = transaction.category;
        break;
      case 'outflow':
        initialValue = transaction.outflow?.toString() || '';
        break;
      case 'inflow':
        initialValue = transaction.inflow?.toString() || '';
        break;
      case 'memo':
        initialValue = transaction.memo;
        break;
    }

    setEditing({
      field,
      value: initialValue,
      originalValue: initialValue,
    });
    setError(null);
  };

  // Handle canceling edit
  const handleCancelEdit = () => {
    setEditing(null);
    setError(null);
  };

  // Handle saving edit
  const handleSaveEdit = async () => {
    if (!editing) return;

    const { field, value } = editing;
    
    // Validate input
    if (field === 'date' && !value) {
      setError('Date is required');
      return;
    }
    
    if ((field === 'outflow' || field === 'inflow') && value && (isNaN(Number(value)) || Number(value) < 0)) {
      setError('Amount must be a positive number');
      return;
    }

    try {
      setSaving(true);
      setError(null);

      // Create updated transaction object for optimistic update
      const updatedTransaction: LedgerTransaction = {
        ...transaction,
        date: field === 'date' ? value : transaction.date,
        payee: field === 'payee' ? value : transaction.payee,
        category: field === 'category' ? value : transaction.category,
        outflow: field === 'outflow' ? (value ? Number(value) : null) : transaction.outflow,
        inflow: field === 'inflow' ? (value ? Number(value) : null) : transaction.inflow,
        memo: field === 'memo' ? value : transaction.memo,
      };

      // Apply optimistic update
      onTransactionUpdate(updatedTransaction, true);
      setEditing(null);

      // Prepare update data based on field
      const updateData: any = {};
      
      switch (field) {
        case 'date':
          updateData.transaction_date = new Date(value).toISOString();
          break;
        case 'payee':
          // This would need to be handled by determining if it's a transfer or external payee
          // For now, we'll update the destination_name
          updateData.destination_name = value;
          break;
        case 'category':
          updateData.category = value;
          break;
        case 'outflow':
          // Convert outflow to positive amount
          updateData.amount = value ? Math.abs(Number(value)) : 0;
          break;
        case 'inflow':
          // Convert inflow to negative amount (for double-entry)
          updateData.amount = value ? -Math.abs(Number(value)) : 0;
          break;
        case 'memo':
          updateData.description = value;
          break;
      }

      // Update transaction via API
      await enhancedApi.updateTransaction(transaction.id, updateData);
      
      // Confirm the optimistic update
      onTransactionUpdate(updatedTransaction, false);
      
    } catch (err) {
      const errorMessage = getErrorMessage(err);
      setError(errorMessage);
      console.error('Error updating transaction:', err);
      
      // Revert optimistic update by calling with original transaction
      onTransactionUpdate(transaction, false);
      
      // Restore editing state
      setEditing({
        field,
        value,
        originalValue: editing.originalValue,
      });
    } finally {
      setSaving(false);
    }
  };

  // Handle keyboard navigation
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      handleCancelEdit();
    } else if (e.key === 'Enter') {
      handleSaveEdit();
    } else if (e.key === 'Tab') {
      // Handle tab navigation between fields
      e.preventDefault();
      handleSaveEdit().then(() => {
        // Move to next field
        const fields: EditableField[] = ['date', 'payee', 'category', 'outflow', 'inflow'];
        const currentIndex = fields.indexOf(editing?.field || 'date');
        const nextIndex = (currentIndex + 1) % fields.length;
        setTimeout(() => handleStartEdit(fields[nextIndex]), 0);
      });
    }
  };

  // Handle cleared status cycling
  const handleClearedStatusClick = async () => {
    if (saving) return;

    const statusCycle: ClearedStatus[] = ['uncleared', 'cleared', 'reconciled'];
    const currentIndex = statusCycle.indexOf(transaction.cleared_status);
    const nextStatus = statusCycle[(currentIndex + 1) % statusCycle.length];

    try {
      setSaving(true);
      setError(null);
      
      const updatedTransaction: LedgerTransaction = {
        ...transaction,
        cleared_status: nextStatus,
      };
      
      // Apply optimistic update
      onTransactionUpdate(updatedTransaction, true);
      
      await enhancedApi.updateClearedStatus(transaction.id, nextStatus);
      
      // Confirm optimistic update
      onTransactionUpdate(updatedTransaction, false);
    } catch (err) {
      const errorMessage = getErrorMessage(err);
      setError(errorMessage);
      console.error('Error updating cleared status:', err);
      
      // Revert optimistic update
      onTransactionUpdate(transaction, false);
    } finally {
      setSaving(false);
    }
  };

  // Handle delete
  const handleDelete = async () => {
    let confirmMessage = 'Are you sure you want to delete this transaction?';
    
    if (transaction.is_transfer) {
      confirmMessage = 'This is a transfer between accounts. Deleting this transaction will only remove this side of the transfer. ' +
        'You may need to manually delete the corresponding transaction in the other account. Continue?';
    }
    
    if (window.confirm(confirmMessage)) {
      try {
        setError(null);
        
        // Apply optimistic update
        onTransactionDelete(transaction.id, true);
        
        await enhancedApi.deleteTransaction(transaction.id);
        
        // Confirm optimistic update
        onTransactionDelete(transaction.id, false);
      } catch (err) {
        const errorMessage = getErrorMessage(err);
        setError(errorMessage);
        console.error('Error deleting transaction:', err);
        
        // The parent component should handle reverting the optimistic update
        // We don't need to do anything here as the transaction will reappear
      }
    }
  };

  // Get cleared status display
  const getClearedStatusDisplay = () => {
    switch (transaction.cleared_status) {
      case 'cleared':
        return '✓';
      case 'reconciled':
        return '🔒';
      default:
        return '';
    }
  };

  // Get cleared status class
  const getClearedStatusClass = () => {
    switch (transaction.cleared_status) {
      case 'cleared':
        return 'cleared';
      case 'reconciled':
        return 'reconciled';
      default:
        return 'uncleared';
    }
  };

  // Check if transaction is in the future
  const isFutureTransaction = new Date(transaction.date) > new Date();

  return (
    <tr 
      className={`transaction-row ${getClearedStatusClass()} ${isFutureTransaction ? 'future' : ''} ${isSelected ? 'selected' : ''} ${transaction.is_transfer ? 'transfer' : ''} ${saving ? 'saving' : ''}`}
    >
      {/* Selection checkbox */}
      <td>
        <input
          type="checkbox"
          checked={isSelected}
          onChange={(e) => onSelectionChange(transaction.id, e.target.checked)}
          aria-label={`Select transaction ${transaction.memo}`}
        />
      </td>

      {/* Cleared status */}
      <td 
        className="cleared-status clickable"
        onClick={handleClearedStatusClick}
        title={`Click to cycle: ${transaction.cleared_status} → ${
          transaction.cleared_status === 'uncleared' ? 'cleared' : 
          transaction.cleared_status === 'cleared' ? 'reconciled' : 'uncleared'
        }`}
      >
        {getClearedStatusDisplay()}
      </td>

      {/* Date */}
      <td 
        className={`date ${editing?.field === 'date' ? 'editing' : 'clickable'}`}
        onClick={() => !editing && handleStartEdit('date')}
        title={transaction.is_transfer ? 'Transfer date - editing may require manual synchronization' : undefined}
      >
        {editing?.field === 'date' ? (
          <input
            ref={inputRef}
            type="date"
            value={editing.value}
            onChange={(e) => setEditing({ ...editing, value: e.target.value })}
            onKeyDown={handleKeyDown}
            onBlur={handleSaveEdit}
            disabled={saving}
          />
        ) : (
          new Date(transaction.date).toLocaleDateString()
        )}
      </td>

      {/* Payee */}
      <td 
        className={`payee ${editing?.field === 'payee' ? 'editing' : 'clickable'} ${transaction.is_transfer ? 'transfer' : ''}`}
        onClick={() => !editing && handleStartEdit('payee')}
        title={transaction.is_transfer ? 'Transfer between accounts - edits may require manual synchronization' : undefined}
      >
        {editing?.field === 'payee' ? (
          <PayeeAutocomplete
            value={editing.value}
            onChange={(value) => setEditing({ ...editing, value })}
            onKeyDown={handleKeyDown}
            onBlur={handleSaveEdit}
            disabled={saving}
            autoFocus
          />
        ) : (
          <>
            {transaction.is_transfer && (
              <span 
                className="transfer-indicator" 
                title="Transfer between accounts"
              >
                ↔
              </span>
            )}
            {transaction.payee}
          </>
        )}
      </td>

      {/* Category */}
      <td 
        className={`category ${editing?.field === 'category' ? 'editing' : 'clickable'}`}
        onClick={() => !editing && handleStartEdit('category')}
      >
        {editing?.field === 'category' ? (
          <CategoryAutocomplete
            value={editing.value}
            onChange={(value) => setEditing({ ...editing, value })}
            onKeyDown={handleKeyDown}
            onBlur={handleSaveEdit}
            disabled={saving}
            autoFocus
          />
        ) : (
          transaction.category
        )}
      </td>

      {/* Outflow */}
      <td 
        className={`amount outflow ${editing?.field === 'outflow' ? 'editing' : 'clickable'}`}
        onClick={() => !editing && transaction.outflow !== null && handleStartEdit('outflow')}
        title={transaction.is_transfer && transaction.outflow !== null ? 'Transfer amount - editing may require manual synchronization' : undefined}
      >
        {editing?.field === 'outflow' ? (
          <input
            ref={inputRef}
            type="number"
            value={editing.value}
            onChange={(e) => setEditing({ ...editing, value: e.target.value })}
            onKeyDown={handleKeyDown}
            onBlur={handleSaveEdit}
            disabled={saving}
            step="0.01"
            min="0"
          />
        ) : (
          transaction.outflow !== null ? transaction.outflow.toFixed(2) : ''
        )}
      </td>

      {/* Inflow */}
      <td 
        className={`amount inflow ${editing?.field === 'inflow' ? 'editing' : 'clickable'}`}
        onClick={() => !editing && transaction.inflow !== null && handleStartEdit('inflow')}
        title={transaction.is_transfer && transaction.inflow !== null ? 'Transfer amount - editing may require manual synchronization' : undefined}
      >
        {editing?.field === 'inflow' ? (
          <input
            ref={inputRef}
            type="number"
            value={editing.value}
            onChange={(e) => setEditing({ ...editing, value: e.target.value })}
            onKeyDown={handleKeyDown}
            onBlur={handleSaveEdit}
            disabled={saving}
            step="0.01"
            min="0"
          />
        ) : (
          transaction.inflow !== null ? transaction.inflow.toFixed(2) : ''
        )}
      </td>

      {/* Running Balance */}
      <td className="amount running-balance">
        {transaction.running_balance !== undefined ? transaction.running_balance.toFixed(2) : ''}
      </td>

      {/* Memo */}
      <td 
        className={`memo ${editing?.field === 'memo' ? 'editing' : 'clickable'}`}
        onClick={() => !editing && handleStartEdit('memo')}
      >
        {editing?.field === 'memo' ? (
          <input
            ref={inputRef}
            type="text"
            value={editing.value}
            onChange={(e) => setEditing({ ...editing, value: e.target.value })}
            onKeyDown={handleKeyDown}
            onBlur={handleSaveEdit}
            disabled={saving}
          />
        ) : (
          transaction.memo
        )}
      </td>

      {/* Actions */}
      <td className="actions">
        <button
          onClick={handleDelete}
          className="button small danger"
          disabled={saving || editing !== null}
          title="Delete transaction"
        >
          Delete
        </button>
      </td>

      {/* Error display */}
      {error && (
        <td colSpan={10} className="error-row">
          <div className="error-message">{error}</div>
        </td>
      )}
    </tr>
  );
};

export default TransactionRow;