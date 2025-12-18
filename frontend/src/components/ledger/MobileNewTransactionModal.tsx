import React, { useState, useEffect } from 'react';
import type { LedgerTransaction } from '../../services/types';
import { transactionsApi } from '../../services/api';
import PayeeAutocomplete from '../common/PayeeAutocomplete';
import CategoryAutocomplete from '../common/CategoryAutocomplete';

interface MobileNewTransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
  accountId: string;
  onTransactionCreate: (newTransaction: LedgerTransaction) => void;
}

interface NewTransactionData {
  date: string;
  payee: string;
  category: string;
  amount: string;
  amountType: 'outflow' | 'inflow';
  memo: string;
}

const MobileNewTransactionModal: React.FC<MobileNewTransactionModalProps> = ({
  isOpen,
  onClose,
  accountId,
  onTransactionCreate,
}) => {
  const [formData, setFormData] = useState<NewTransactionData>({
    date: new Date().toISOString().split('T')[0],
    payee: '',
    category: '',
    amount: '',
    amountType: 'outflow',
    memo: '',
  });
  
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setFormData({
        date: new Date().toISOString().split('T')[0],
        payee: '',
        category: '',
        amount: '',
        amountType: 'outflow',
        memo: '',
      });
      setError(null);
    }
  }, [isOpen]);

  // Handle field changes
  const handleFieldChange = (field: keyof NewTransactionData, value: string) => {
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
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    try {
      setSaving(true);
      setError(null);

      const amount = Number(formData.amount);
      const isOutflow = formData.amountType === 'outflow';

      // Create transaction data
      const transactionData = {
        source_account_id: isOutflow ? accountId : '',
        destination_account_id: isOutflow ? '' : accountId,
        destination_name: formData.payee,
        description: formData.memo || formData.payee,
        amount: amount,
        category: formData.category || 'Uncategorized',
        transaction_date: formData.date,
      };

      const createdTransaction = await transactionsApi.createTransaction(transactionData);
      
      // Convert to LedgerTransaction format
      const ledgerTransaction: LedgerTransaction = {
        id: createdTransaction.id,
        date: formData.date,
        payee: formData.payee,
        category: formData.category || 'Uncategorized',
        cleared_status: 'uncleared',
        outflow: isOutflow ? amount : null,
        inflow: isOutflow ? null : amount,
        memo: formData.memo || formData.payee,
        is_transfer: false,
      };

      onTransactionCreate(ledgerTransaction);
      onClose();
      
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to create transaction';
      setError(errorMessage);
      console.error('Error creating transaction:', err);
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

  if (!isOpen) return null;

  return (
    <div 
      className={`mobile-new-transaction-modal ${isOpen ? 'open' : ''}`}
      onClick={handleBackdropClick}
    >
      <div className="mobile-modal-content" onClick={(e) => e.stopPropagation()}>
        {/* Modal Header */}
        <div className="mobile-modal-header">
          <h2 className="mobile-modal-title">New Transaction</h2>
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

          {/* Date Field */}
          <div className="mobile-form-group">
            <label className="mobile-form-label">Date</label>
            <input
              type="date"
              value={formData.date}
              onChange={(e) => handleFieldChange('date', e.target.value)}
              disabled={saving}
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
                disabled={saving}
              >
                Outflow (Expense)
              </button>
              <button
                type="button"
                className={`mobile-amount-toggle-btn inflow ${formData.amountType === 'inflow' ? 'active' : ''}`}
                onClick={() => handleFieldChange('amountType', 'inflow')}
                disabled={saving}
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
              disabled={saving}
              placeholder="0.00"
              step="0.01"
              min="0"
              className="mobile-form-input"
            />
          </div>

          {/* Memo Field */}
          <div className="mobile-form-group">
            <label className="mobile-form-label">Memo (Optional)</label>
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
            {saving ? 'Creating Transaction...' : 'Create Transaction'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default MobileNewTransactionModal;