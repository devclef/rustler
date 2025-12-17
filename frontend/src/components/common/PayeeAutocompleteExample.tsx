import { useState } from 'react';
import PayeeAutocomplete from './PayeeAutocomplete';
import CategoryInput from './CategoryInput';

/**
 * Example component showing how to use PayeeAutocomplete with CategoryInput
 * for automatic category filling when a payee is selected.
 */
const PayeeAutocompleteExample: React.FC = () => {
  const [payee, setPayee] = useState('');
  const [category, setCategory] = useState('');

  const handleCategoryAutoFill = (categoryId: string | null, categoryName: string | null) => {
    if (categoryName) {
      setCategory(categoryName);
      console.log('Auto-filled category:', { categoryId, categoryName });
    }
  };

  return (
    <div style={{ padding: '20px', maxWidth: '500px' }}>
      <h3>Transaction Form Example</h3>
      
      <div style={{ marginBottom: '16px' }}>
        <label style={{ display: 'block', marginBottom: '4px', fontWeight: 'bold' }}>
          Payee:
        </label>
        <PayeeAutocomplete
          value={payee}
          onChange={setPayee}
          onCategoryAutoFill={handleCategoryAutoFill}
          placeholder="Select or enter a payee..."
        />
        <small style={{ color: '#666', fontSize: '12px' }}>
          Start typing to see account and external payee suggestions
        </small>
      </div>

      <div style={{ marginBottom: '16px' }}>
        <label style={{ display: 'block', marginBottom: '4px', fontWeight: 'bold' }}>
          Category:
        </label>
        <CategoryInput
          value={category}
          onChange={setCategory}
          placeholder="Select or create a category..."
        />
        <small style={{ color: '#666', fontSize: '12px' }}>
          This will be auto-filled when you select a payee that has been used before
        </small>
      </div>

      <div style={{ 
        padding: '12px', 
        backgroundColor: '#f8f9fa', 
        border: '1px solid #dee2e6', 
        borderRadius: '4px',
        fontSize: '14px'
      }}>
        <strong>Current Values:</strong>
        <br />
        Payee: {payee || '(none)'}
        <br />
        Category: {category || '(none)'}
      </div>
    </div>
  );
};

export default PayeeAutocompleteExample;