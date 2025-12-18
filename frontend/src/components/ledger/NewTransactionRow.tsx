import { useState, useRef, useEffect, useImperativeHandle, forwardRef, type KeyboardEvent } from 'react';
import type { LedgerTransaction } from '../../services/types';
import { enhancedApi } from '../../services/enhancedApi';
import { getErrorMessage } from '../../utils/errorHandling';
import PayeeAutocomplete from '../common/PayeeAutocomplete';
import CategoryAutocomplete from '../common/CategoryAutocomplete';
import './NewTransactionRow.css';

interface NewTransactionRowProps {
  accountId: string;
  onTransactionCreate: (newTransaction: LedgerTransaction, optimistic?: boolean) => void;
}

export interface NewTransactionRowRef {
  focusDateField: () => void;
}

interface NewTransactionData {
  date: string;
  payee: string;
  category: string;
  outflow: string;
  inflow: string;
  memo: string;
}

const NewTransactionRow = forwardRef<NewTransactionRowRef, NewTransactionRowProps>(({
  accountId,
  onTransactionCreate,
}, ref) => {
  const [formData, setFormData] = useState<NewTransactionData>({
    date: new Date().toISOString().split('T')[0],
    payee: '',
    category: '',
    outflow: '',
    inflow: '',
    memo: '',
  });
  
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  
  const dateRef = useRef<HTMLInputElement>(null);
  const payeeRef = useRef<HTMLInputElement>(null);
  const categoryRef = useRef<HTMLInputElement>(null);
  const outflowRef = useRef<HTMLInputElement>(null);
  const inflowRef = useRef<HTMLInputElement>(null);
  const memoRef = useRef<HTMLInputElement>(null);

  // Focus date field on mount
  useEffect(() => {
    if (dateRef.current) {
      dateRef.current.focus();
    }
  }, []);

  // Expose focusDateField method to parent
  useImperativeHandle(ref, () => ({
    focusDateField: () => {
      if (dateRef.current) {
        dateRef.current.focus();
      }
    },
  }), []);

  // Handle field changes
  const handleFieldChange = (field: keyof NewTransactionData, value: string) => {
    setFormData(prev => ({
      ...prev,
      [field]: value,
    }));
    
    // Clear the opposite amount field when entering an amount
    if (field === 'outflow' && value) {
      setFormData(prev => ({ ...prev, inflow: '' }));
    } else if (field === 'inflow' && value) {
      setFormData(prev => ({ ...prev, outflow: '' }));
    }
    
    setError(null);
  };

  // Handle category auto-fill from payee selection
  const handleCategoryAutoFill = (_categoryId: string | null, categoryName: string | null) => {
    if (categoryName && !formData.category) {
      setFormData(prev => ({ ...prev, category: categoryName }));
    }
  };

  // Validate form data
  const validateForm = (): string | null => {
    if (!formData.date) {
      return 'Date is required';
    }
    
    if (!formData.payee.trim()) {
      return 'Payee is required';
    }
    
    const hasOutflow = formData.outflow && !isNaN(Number(formData.outflow)) && Number(formData.outflow) > 0;
    const hasInflow = formData.inflow && !isNaN(Number(formData.inflow)) && Number(formData.inflow) > 0;
    
    if (!hasOutflow && !hasInflow) {
      return 'Please enter an amount in either outflow or inflow';
    }
    
    if (hasOutflow && hasInflow) {
      return 'Please enter amount in only one field (outflow or inflow)';
    }
    
    return null;
  };

  // Handle form submission
  const handleSubmit = async () => {
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    try {
      setSaving(true);
      setError(null);

      const hasOutflow = formData.outflow && Number(formData.outflow) > 0;
      const amount = hasOutflow ? Number(formData.outflow) : Number(formData.inflow);

      // Create optimistic transaction for immediate UI feedback
      const optimisticId = `temp-${Date.now()}`;
      const ledgerTransaction: LedgerTransaction = {
        id: optimisticId,
        date: formData.date,
        payee: formData.payee,
        category: formData.category || 'Uncategorized',
        cleared_status: 'uncleared',
        outflow: hasOutflow ? Number(formData.outflow) : null,
        inflow: hasOutflow ? null : Number(formData.inflow),
        memo: formData.memo || formData.payee,
        is_transfer: false, // Will be determined by backend
      };

      // Apply optimistic update
      onTransactionCreate(ledgerTransaction, true);

      // Clear form immediately for better UX
      setFormData({
        date: new Date().toISOString().split('T')[0],
        payee: '',
        category: '',
        outflow: '',
        inflow: '',
        memo: '',
      });

      // Create transaction data - following the Transaction interface
      const transactionData = {
        source_account_id: hasOutflow ? accountId : '', // If outflow, current account is source
        destination_account_id: hasOutflow ? '' : accountId, // If inflow, current account is destination
        destination_name: formData.payee,
        description: formData.memo || formData.payee,
        amount: amount, // Always positive amount
        category: formData.category || 'Uncategorized',
        transaction_date: formData.date, // Send as date string, not ISO
      };

      const createdTransaction = await enhancedApi.createTransaction(transactionData);
      
      // Convert to LedgerTransaction format with real ID
      const confirmedTransaction: LedgerTransaction = {
        ...ledgerTransaction,
        id: createdTransaction.id,
      };

      // Confirm optimistic update with real transaction
      onTransactionCreate(confirmedTransaction, false);
      
      // Focus date field for next transaction
      setTimeout(() => {
        if (dateRef.current) {
          dateRef.current.focus();
        }
      }, 0);
      
    } catch (err) {
      const errorMessage = getErrorMessage(err);
      setError(errorMessage);
      console.error('Error creating transaction:', err);
      
      // Restore form data on error
      // The optimistic update will be reverted by the parent component
    } finally {
      setSaving(false);
    }
  };

  // Handle keyboard navigation
  const handleKeyDown = (e: KeyboardEvent, currentField: keyof NewTransactionData) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      
      // Check if we have minimum required data to submit
      const hasRequiredData = formData.payee.trim() && (formData.outflow || formData.inflow);
      
      // If we're in the last meaningful field or have valid data, submit
      if (hasRequiredData && (currentField === 'memo' || currentField === 'outflow' || currentField === 'inflow')) {
        handleSubmit();
      } else {
        // Move to next field
        moveToNextField(currentField);
      }
    } else if (e.key === 'Tab') {
      // Let default tab behavior handle field navigation
      return;
    } else if (e.key === 'Escape') {
      // Clear current field
      handleFieldChange(currentField, '');
    }
  };

  // Move focus to next field following the order: date → payee → category → outflow → inflow → memo
  const moveToNextField = (currentField: keyof NewTransactionData) => {
    const fieldOrder: (keyof NewTransactionData)[] = ['date', 'payee', 'category', 'outflow', 'inflow', 'memo'];
    const currentIndex = fieldOrder.indexOf(currentField);
    
    // Skip to the appropriate amount field based on what's enabled
    let nextField = fieldOrder[currentIndex + 1];
    
    // If moving from category to amount fields, choose the appropriate one
    if (currentField === 'category') {
      // Default to outflow unless inflow is already filled
      nextField = formData.inflow ? 'inflow' : 'outflow';
    } else if (currentField === 'outflow' && formData.outflow) {
      // Skip inflow if outflow is filled
      nextField = 'memo';
    } else if (currentField === 'inflow' && formData.inflow) {
      // Skip outflow if inflow is filled
      nextField = 'memo';
    }
    
    if (nextField) {
      const refs = {
        date: dateRef,
        payee: payeeRef,
        category: categoryRef,
        outflow: outflowRef,
        inflow: inflowRef,
        memo: memoRef,
      };
      
      const nextRef = refs[nextField];
      if (nextRef?.current) {
        nextRef.current.focus();
      }
    }
  };

  return (
    <tr className={`new-transaction-row ${saving ? 'saving' : ''}`}>
      {/* Selection checkbox (disabled for new row) */}
      <td>
        <input type="checkbox" disabled />
      </td>

      {/* Cleared status (always uncleared for new transactions) */}
      <td className="cleared-status">
        <span className="new-indicator">+</span>
      </td>

      {/* Date */}
      <td className="date">
        <input
          ref={dateRef}
          type="date"
          value={formData.date}
          onChange={(e) => handleFieldChange('date', e.target.value)}
          onKeyDown={(e) => handleKeyDown(e, 'date')}

          disabled={saving}
          className="new-transaction-input"
        />
      </td>

      {/* Payee */}
      <td className="payee">
        <PayeeAutocomplete
          value={formData.payee}
          onChange={(value) => handleFieldChange('payee', value)}
          onCategoryAutoFill={handleCategoryAutoFill}
          onKeyDown={(e) => handleKeyDown(e, 'payee')}
          disabled={saving}
          placeholder="Enter payee"
          className="new-transaction-input"
        />
      </td>

      {/* Category */}
      <td className="category">
        <CategoryAutocomplete
          value={formData.category}
          onChange={(value) => handleFieldChange('category', value)}
          onKeyDown={(e) => handleKeyDown(e, 'category')}
          disabled={saving}
          placeholder="Enter category"
          className="new-transaction-input"
        />
      </td>

      {/* Outflow */}
      <td className="amount outflow">
        <input
          ref={outflowRef}
          type="number"
          value={formData.outflow}
          onChange={(e) => handleFieldChange('outflow', e.target.value)}
          onKeyDown={(e) => handleKeyDown(e, 'outflow')}

          disabled={saving || !!formData.inflow}
          placeholder="0.00"
          step="0.01"
          min="0"
          className="new-transaction-input"
        />
      </td>

      {/* Inflow */}
      <td className="amount inflow">
        <input
          ref={inflowRef}
          type="number"
          value={formData.inflow}
          onChange={(e) => handleFieldChange('inflow', e.target.value)}
          onKeyDown={(e) => handleKeyDown(e, 'inflow')}

          disabled={saving || !!formData.outflow}
          placeholder="0.00"
          step="0.01"
          min="0"
          className="new-transaction-input"
        />
      </td>

      {/* Running Balance (empty for new row) */}
      <td className="amount running-balance">
        —
      </td>

      {/* Memo */}
      <td className="memo">
        <input
          ref={memoRef}
          type="text"
          value={formData.memo}
          onChange={(e) => handleFieldChange('memo', e.target.value)}
          onKeyDown={(e) => handleKeyDown(e, 'memo')}

          disabled={saving}
          placeholder="Optional memo"
          className="new-transaction-input"
        />
      </td>

      {/* Actions */}
      <td className="actions">
        <button
          onClick={handleSubmit}
          disabled={saving || !formData.payee || (!formData.outflow && !formData.inflow)}
          className="button small primary"
          title="Add transaction (Enter)"
        >
          {saving ? 'Adding...' : 'Add'}
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
});

NewTransactionRow.displayName = 'NewTransactionRow';

export default NewTransactionRow;