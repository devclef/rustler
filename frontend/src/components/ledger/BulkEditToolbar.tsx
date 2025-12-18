import React, { useState } from 'react';
import type { ClearedStatus } from '../../services/types';
import { enhancedApi } from '../../services/enhancedApi';
import { getErrorMessage } from '../../utils/errorHandling';
import CategoryAutocomplete from '../common/CategoryAutocomplete';
import LoadingSpinner from '../common/LoadingSpinner';
import './BulkEditToolbar.css';

interface BulkEditToolbarProps {
  selectedTransactionIds: Set<string>;
  onBulkUpdate: () => void;
  onClearSelection: () => void;
}

const BulkEditToolbar: React.FC<BulkEditToolbarProps> = ({
  selectedTransactionIds,
  onBulkUpdate,
  onClearSelection,
}) => {
  const [category, setCategory] = useState('');
  const [clearedStatus, setClearedStatus] = useState<ClearedStatus | ''>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleApply = async () => {
    if (selectedTransactionIds.size === 0) return;

    try {
      setLoading(true);
      setError(null);

      const updates: any = {};
      
      if (category) {
        updates.category = category;
      }
      
      if (clearedStatus) {
        updates.cleared_status = clearedStatus;
      }

      if (Object.keys(updates).length === 0) {
        setError('Please select at least one field to update');
        setLoading(false);
        return;
      }

      const result = await enhancedApi.bulkUpdateTransactions(
        Array.from(selectedTransactionIds), 
        updates
      );
      
      if (result.failed && result.failed.length > 0) {
        setError(`Updated ${result.updated} transactions, but ${result.failed.length} failed`);
      }
      
      onBulkUpdate();
      
      // Reset form
      setCategory('');
      setClearedStatus('');
      
    } catch (err) {
      const errorMessage = getErrorMessage(err);
      setError(errorMessage);
      console.error('Error in bulk update:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    setCategory('');
    setClearedStatus('');
    setError(null);
    onClearSelection();
  };

  if (selectedTransactionIds.size === 0) {
    return null;
  }

  return (
    <div className="bulk-edit-toolbar">
      <div className="bulk-edit-header">
        <h3>Bulk Edit ({selectedTransactionIds.size} transactions selected)</h3>
        <button 
          className="close-button"
          onClick={handleCancel}
          disabled={loading}
          title="Cancel bulk edit"
        >
          ×
        </button>
      </div>

      {error && (
        <div className="bulk-edit-error">
          {error}
        </div>
      )}

      <div className="bulk-edit-form">
        <div className="bulk-edit-field">
          <label htmlFor="bulk-category">Category:</label>
          <CategoryAutocomplete
            value={category}
            onChange={setCategory}
            placeholder="Select category to apply"
            disabled={loading}
            className="bulk-edit-input"
          />
        </div>

        <div className="bulk-edit-field">
          <label htmlFor="bulk-cleared-status">Cleared Status:</label>
          <select
            id="bulk-cleared-status"
            value={clearedStatus}
            onChange={(e) => setClearedStatus(e.target.value as ClearedStatus | '')}
            disabled={loading}
            className="bulk-edit-input"
          >
            <option value="">No change</option>
            <option value="uncleared">Uncleared</option>
            <option value="cleared">Cleared</option>
            <option value="reconciled">Reconciled</option>
          </select>
        </div>

        <div className="bulk-edit-actions">
          <button
            onClick={handleApply}
            disabled={loading || (!category && !clearedStatus)}
            className="button primary"
          >
            {loading ? (
              <>
                <LoadingSpinner size="small" />
                Applying...
              </>
            ) : (
              'Apply Changes'
            )}
          </button>
          <button
            onClick={handleCancel}
            disabled={loading}
            className="button secondary"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

export default BulkEditToolbar;