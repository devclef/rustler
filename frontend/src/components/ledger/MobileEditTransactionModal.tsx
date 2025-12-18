import React, { useState, useEffect } from 'react';
import type { LedgerTransaction } from '../../services/types';
import { transactionsApi } from '../../services/api';
import PayeeAutocomplete from '../common/PayeeAutocomplete';
import CategoryAutocomplete from '../common/CategoryAutocomplete';

interface MobileEditTransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
  transaction: LedgerTransaction | null;
  accountId: string;
  onTransactionUpdate: (updatedTransaction: LedgerTransaction) => void;
}

interface EditTransactionData {
  date: string;
  payee: string;
  category: string;
  amount: string;
  amountType: 'outflow' | 'inflow';
  memo: string;
}

const MobileEditTransactionModal: React.FC<MobileEditTransactionModalProps> = ({
  isOpen,
  onClose,
  transaction,
  accountId: _accountId,
  onTransactionUpdate,
}) => {
  const [formData, setFormData] = useState<EditTransactionData>({
    date: '',
    payee: '',
    category: '',
    amount: '',
    amountType: 'outflow',
    memo: '',
  });
  
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Populate form when transaction changes
  useEffect(() => {
    if (isOpen && transaction) {
      const isOutflow = transaction.outflow !== null;
      const amount = isOutflow ? transaction.outflow : transaction.inflow;
      
      setFormData({
        date: new Date(transaction.date).toISOString().split('T')[0],
        payee: transaction.payee,
        category: transaction.category,
        amount: amount?.toString() || '',
        amountType: isOutflow ? 'outflow' : 'inflow',
        memo: transaction.memo,
      });
      setError(null);
    }
  }, [isOpen, transaction]);

  // Handle field changes
  const handleFieldChange = (field: keyof EditTransactionData, value: string) => {
    setFormData(prev => ({
      ...prev,
      [field]: value,
    }));
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
    
    if (!formData.amount || isNaN(Number(formData.amount)) || Number(formData.amount) <= 0) {
      return 'Please enter a valid amount';
    }
    
    return null;
  };

  // Handle form submission
  const handleSubmit = async () => {
    if (!transaction) return;

    // Check if transaction is reconciled and trying to edit restricted fields
    if (transaction.cleared_status === 'reconciled') {
      const originalAmount = transaction.outflow || transaction.inflow || 0;
      const originalDate = new Date(transaction.date).toISOString().split('T')[0];
      
      if (formData.amount !== originalAmount.toString() || formData.date !== originalDate) {
        setError('Cannot edit amount or date of reconciled transactions');
        return;
      }
    }

    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    try {
      setSaving(true);
      setError(null);

      // Show warning for transfer edits
      if (transaction.is_transfer) {
        const shouldProceed = window.confirm(
          'This is a transfer between accounts. Editing this transaction will only affect this side of the transfer. ' +
          'You may need to manually update the corresponding transaction in the other account. Continue?'
        );
        if (!shouldProceed) {
          setSaving(false);
          return;
        }
      }

      // Prepare update data
      const updateData: any = {
        transaction_date: new Date(formData.date).toISOString(),
        destination_name: formData.payee,
        category: formData.category,
        description: formData.memo,
      };

      // Only update amount if it changed
      const newAmount = Number(formData.amount);
      const currentAmount = transaction.outflow || transaction.inflow || 0;
      if (newAmount !== currentAmount) {
        updateData.amount = newAmount;
      }

      await transactionsApi.updateTransaction(transaction.id, updateData);
      
      // Create updated transaction object
      const updatedTransaction: LedgerTransaction = {
        ...transaction,
        date: formData.date,
        payee: formData.payee,
        category: formData.category,
        outflow: formData.amountType === 'outflow' ? newAmount : null,
        inflow: formData.amountType === 'inflow' ? newAmount : null,
        memo: formData.memo,
      };

      onTransactionUpdate(updatedTransaction);
      onClose();
      
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to update transaction';
      setError(errorMessage);
      console.error('Error updating transaction:', err);
    } finally {
      setSaving(false);
    }
  };

  // Handle modal close
  const handleClose = () => {
    if (!saving) {
      onClose();
    }
  };

  // Handle backdrop click
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      handleClose();
    }
  };

  if (!isOpen || !transaction) return null;

  const isReconciled = transaction.cleared_status === 'reconciled';

  return (
    <div 
      className={`mobile-new-transaction-modal ${isOpen ? 'open' : ''}`}
      onClick={handleBackdropClick}
    >
      <div className="mobile-modal-content" onClick={(e) => e.stopPropagation()}>
        {/* Modal Header */}
        <div className="mobile-modal-header">
          <h2 className="mobile-modal-title">Edit Transaction</h2>
          <button
            className="mobile-modal-close"
            onClick={handleClose}
            disabled={saving}
          >
            ×
          </button>
        </div>

        {/* Modal Body */}
        <div className="mobile-modal-body">
          {/* Error Display */}
          {error && (
            <div className="mobile-error-message">
              {error}
            </div>
          )}

          {/* Reconciled Warning */}
          {isReconciled && (
            <div className="mobile-warning-message">
              ⚠️ This transaction is reconciled. Amount and date cannot be changed.
            </div>
          )}

          {/* Transfer Warning */}
          {transaction.is_transfer && (
            <div className="mobile-info-message">
              ↔ This is a transfer between accounts. Changes will only affect this side.
            </div>
          )}

          {/* Date Field */}
          <div className="mobile-form-group">
            <label className="mobile-form-label">Date</label>
            <input
              type="date"
              value={formData.date}
              onChange={(e) => handleFieldChange('date', e.target.value)}
              disabled={saving || isReconciled}
              className="mobile-form-input"
            />
          </div>

          {/* Payee Field */}
          <div className="mobile-form-group">
            <label className="mobile-form-label">Payee</label>
            <PayeeAutocomplete
              value={formData.payee}
              onChange={(value) => handleFieldChange('payee', value)}
              onCategoryAutoFill={handleCategoryAutoFill}
              disabled={saving}
              placeholder="Enter payee name"
              className="mobile-form-input"
            />
          </div>

          {/* Category Field */}
          <div className="mobile-form-group">
            <label className="mobile-form-label">Category</label>
            <CategoryAutocomplete
              value={formData.category}
              onChange={(value) => handleFieldChange('category', value)}
              disabled={saving}
              placeholder="Enter category"
              className="mobile-form-input"
            />
          </div>

          {/* Amount Type Toggle */}
          <div className="mobile-form-group">
            <label className="mobile-form-label">Transaction Type</label>
            <div className="mobile-amount-toggle">
              <button
                type="button"
                className={`mobile-amount-toggle-btn outflow ${formData.amountType === 'outflow' ? 'active' : ''}`}
                onClick={() => handleFieldChange('amountType', 'outflow')}
                disabled={saving || isReconciled}
              >
                Outflow (Expense)
              </button>
              <button
                type="button"
                className={`mobile-amount-toggle-btn inflow ${formData.amountType === 'inflow' ? 'active' : ''}`}
                onClick={() => handleFieldChange('amountType', 'inflow')}
                disabled={saving || isReconciled}
              >
                Inflow (Income)
              </button>
            </div>
          </div>

          {/* Amount Field */}
          <div className="mobile-form-group">
            <label className="mobile-form-label">
              Amount ({formData.amountType === 'outflow' ? 'Outflow' : 'Inflow'})
            </label>
            <input
              type="number"
              value={formData.amount}
              onChange={(e) => handleFieldChange('amount', e.target.value)}
              disabled={saving || isReconciled}
              placeholder="0.00"
              step="0.01"
              min="0"
              className="mobile-form-input"
            />
          </div>

          {/* Memo Field */}
          <div className="mobile-form-group">
            <label className="mobile-form-label">Memo</label>
            <input
              type="text"
              value={formData.memo}
              onChange={(e) => handleFieldChange('memo', e.target.value)}
              disabled={saving}
              placeholder="Optional memo"
              className="mobile-form-input"
            />
          </div>
        </div>

        {/* Modal Footer */}
        <div className="mobile-modal-footer">
          <button
            onClick={handleSubmit}
            disabled={saving || !formData.payee || !formData.amount}
            className="mobile-submit-btn"
          >
            {saving ? 'Updating Transaction...' : 'Update Transaction'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default MobileEditTransactionModal;