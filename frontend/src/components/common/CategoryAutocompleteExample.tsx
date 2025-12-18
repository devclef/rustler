import { useState } from 'react';
import CategoryAutocomplete from './CategoryAutocomplete';

/**
 * Example component demonstrating how to use CategoryAutocomplete
 * This shows the basic usage pattern for the component
 */
const CategoryAutocompleteExample: React.FC = () => {
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | undefined>();

  const handleCategoryChange = (categoryName: string, categoryId?: string) => {
    setSelectedCategory(categoryName);
    setSelectedCategoryId(categoryId);
    console.log('Category selected:', { categoryName, categoryId });
  };

  return (
    <div style={{ padding: '20px', maxWidth: '400px' }}>
      <h3>Category Autocomplete Example</h3>
      
      <div style={{ marginBottom: '20px' }}>
        <label htmlFor="category-input" style={{ display: 'block', marginBottom: '8px' }}>
          Select Category:
        </label>
        <CategoryAutocomplete
          value={selectedCategory}
          onChange={handleCategoryChange}
          placeholder="Type to search categories..."
        />
      </div>

      <div style={{ marginTop: '20px', padding: '10px', backgroundColor: '#f5f5f5', borderRadius: '4px' }}>
        <h4>Selected Values:</h4>
        <p><strong>Category Name:</strong> {selectedCategory || 'None'}</p>
        <p><strong>Category ID:</strong> {selectedCategoryId || 'None'}</p>
      </div>

      <div style={{ marginTop: '20px', fontSize: '14px', color: '#666' }}>
        <h4>Features:</h4>
        <ul>
          <li>Type to filter existing categories</li>
          <li>Use arrow keys to navigate suggestions</li>
          <li>Press Enter or click to select</li>
          <li>Type a new category name to create it on the fly</li>
          <li>Press Escape to close suggestions</li>
        </ul>
      </div>
    </div>
  );
};

export default CategoryAutocompleteExample;