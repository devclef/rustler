import React, { useState, useRef, useEffect } from 'react';
import type { LedgerTransaction, ClearedStatus } from '../../services/types';
import { transactionsApi } from '../../services/api';

interface MobileTransactionCardProps {
  transaction: LedgerTransaction;
  accountId: string;
  onTransactionUpdate: (updatedTransaction: LedgerTransaction) => void;
  onTransactionDelete: (transactionId: string) => void;
  isSelected: boolean;
  onSelectionChange: (transactionId: string, selected: boolean) => void;
  onEdit: (transaction: LedgerTransaction) => void;
}

interface SwipeState {
  startX: number;
  currentX: number;
  isDragging: boolean;
  isOpen: boolean;
}

const MobileTransactionCard: React.FC<MobileTransactionCardProps> = ({
  transaction,
  accountId: _accountId,
  onTransactionUpdate,
  onTransactionDelete,
  isSelected,
  onSelectionChange,
  onEdit,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [swipeState, setSwipeState] = useState<SwipeState>({
    startX: 0,
    currentX: 0,
    isDragging: false,
    isOpen: false,
  });
  const [saving, setSaving] = useState(false);

  const cardRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Handle touch start
  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    setSwipeState(prev => ({
      ...prev,
      startX: touch.clientX,
      currentX: touch.clientX,
      isDragging: true,
    }));
  };

  // Handle touch move
  const handleTouchMove = (e: React.TouchEvent) => {
    if (!swipeState.isDragging) return;

    const touch = e.touches[0];
    const deltaX = swipeState.startX - touch.clientX;
    
    // Only allow left swipe (positive deltaX)
    if (deltaX > 0) {
      setSwipeState(prev => ({
        ...prev,
        currentX: touch.clientX,
      }));

      // Update transform
      if (contentRef.current) {
        const maxSwipe = 150; // Maximum swipe distance
        const swipeDistance = Math.min(deltaX, maxSwipe);
        contentRef.current.style.transform = `translateX(-${swipeDistance}px)`;
      }
    }
  };

  // Handle touch end
  const handleTouchEnd = () => {
    if (!swipeState.isDragging) return;

    const deltaX = swipeState.startX - swipeState.currentX;
    const threshold = 50; // Minimum swipe distance to open actions

    if (deltaX > threshold) {
      // Open swipe actions
      setSwipeState(prev => ({ ...prev, isOpen: true, isDragging: false }));
      if (contentRef.current) {
        contentRef.current.style.transform = 'translateX(-150px)';
      }
    } else {
      // Close swipe actions
      setSwipeState(prev => ({ ...prev, isOpen: false, isDragging: false }));
      if (contentRef.current) {
        contentRef.current.style.transform = 'translateX(0)';
      }
    }
  };

  // Close swipe actions when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (cardRef.current && !cardRef.current.contains(event.target as Node)) {
        if (swipeState.isOpen) {
          setSwipeState(prev => ({ ...prev, isOpen: false }));
          if (contentRef.current) {
            contentRef.current.style.transform = 'translateX(0)';
          }
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [swipeState.isOpen]);

  // Handle cleared status cycling
  const handleClearedStatusClick = async () => {
    if (saving) return;

    const statusCycle: ClearedStatus[] = ['uncleared', 'cleared', 'reconciled'];
    const currentIndex = statusCycle.indexOf(transaction.cleared_status);
    const nextStatus = statusCycle[(currentIndex + 1) % statusCycle.length];

    try {
      setSaving(true);
      await transactionsApi.updateClearedStatus(transaction.id, nextStatus);
      
      const updatedTransaction: LedgerTransaction = {
        ...transaction,
        cleared_status: nextStatus,
      };
      
      onTransactionUpdate(updatedTransaction);
    } catch (err) {
      console.error('Error updating cleared status:', err);
    } finally {
      setSaving(false);
    }
  };

  // Handle delete
  const handleDelete = async () => {
    let confirmMessage = 'Are you sure you want to delete this transaction?';
    
    if (transaction.is_transfer) {
      confirmMessage = 'This is a transfer between accounts. Deleting this transaction will only remove this side of the transfer. Continue?';
    }
    
    if (window.confirm(confirmMessage)) {
      try {
        await transactionsApi.deleteTransaction(transaction.id);
        onTransactionDelete(transaction.id);
      } catch (err) {
        console.error('Error deleting transaction:', err);
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
        return '○';
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

  // Format amount for display
  const formatAmount = () => {
    if (transaction.outflow !== null) {
      return {
        amount: transaction.outflow.toFixed(2),
        type: 'outflow' as const,
        prefix: '-',
      };
    } else if (transaction.inflow !== null) {
      return {
        amount: transaction.inflow.toFixed(2),
        type: 'inflow' as const,
        prefix: '+',
      };
    }
    return { amount: '0.00', type: 'outflow' as const, prefix: '' };
  };

  const amountInfo = formatAmount();

  return (
    <div
      ref={cardRef}
      className={`mobile-transaction-card ${getClearedStatusClass()} ${
        isFutureTransaction ? 'future' : ''
      } ${transaction.is_transfer ? 'transfer' : ''} ${isSelected ? 'selected' : ''}`}
    >
      <div className="mobile-card-swipe-container">
        {/* Swipe Actions */}
        <div className="mobile-swipe-actions">
          <button
            className="mobile-swipe-action edit"
            onClick={() => onEdit(transaction)}
          >
            Edit
          </button>
          <button
            className="mobile-swipe-action clear"
            onClick={handleClearedStatusClick}
            disabled={saving}
          >
            {transaction.cleared_status === 'uncleared' ? 'Clear' : 
             transaction.cleared_status === 'cleared' ? 'Reconcile' : 'Uncleared'}
          </button>
          <button
            className="mobile-swipe-action delete"
            onClick={handleDelete}
          >
            Delete
          </button>
        </div>

        {/* Card Content */}
        <div
          ref={contentRef}
          className={`mobile-card-content ${swipeState.isDragging ? 'swiping' : ''}`}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {/* Card Header */}
          <div className="mobile-card-header">
            <div className="mobile-card-date-status">
              <span className="mobile-card-date">
                {new Date(transaction.date).toLocaleDateString()}
              </span>
              <span 
                className={`mobile-card-status ${getClearedStatusClass()}`}
                onClick={handleClearedStatusClick}
              >
                {getClearedStatusDisplay()}
              </span>
            </div>
            <div className={`mobile-card-amount ${amountInfo.type}`}>
              {amountInfo.prefix}${amountInfo.amount}
            </div>
          </div>

          {/* Card Body */}
          <div className={`mobile-card-body ${expanded ? '' : 'collapsed'}`}>
            <div className="mobile-card-row">
              <span className="mobile-card-label">Payee:</span>
              <span className={`mobile-card-value ${transaction.is_transfer ? 'transfer' : ''}`}>
                {transaction.is_transfer && (
                  <span className="transfer-indicator">↔</span>
                )}
                {transaction.payee}
              </span>
            </div>
            
            <div className="mobile-card-row">
              <span className="mobile-card-label">Category:</span>
              <span className="mobile-card-value">{transaction.category}</span>
            </div>
            
            {transaction.memo && (
              <div className="mobile-card-row">
                <span className="mobile-card-label">Memo:</span>
                <span className="mobile-card-value">{transaction.memo}</span>
              </div>
            )}
          </div>

          {/* Card Footer */}
          <div className="mobile-card-footer">
            <div className="mobile-card-balance">
              Balance: <span className="mobile-card-balance-value">
                ${transaction.running_balance?.toFixed(2) || '0.00'}
              </span>
            </div>
            
            <div className="mobile-card-actions">
              <button
                className="mobile-card-expand-btn"
                onClick={() => setExpanded(!expanded)}
              >
                <span className={`mobile-card-expand-icon ${expanded ? 'expanded' : ''}`}>
                  ▼
                </span>
                {expanded ? 'Less' : 'More'}
              </button>
              
              <div className="mobile-card-select">
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={(e) => onSelectionChange(transaction.id, e.target.checked)}
                  aria-label={`Select transaction ${transaction.memo}`}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MobileTransactionCard;