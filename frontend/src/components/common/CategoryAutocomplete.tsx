import { useState, useEffect, useRef, useCallback } from 'react';
import { categoriesApi } from '../../services/api';
import { getErrorMessage } from '../../utils/errorHandling';
import type { Category } from '../../services/types';
import './CategoryAutocomplete.css';

interface CategoryAutocompleteProps {
  value: string;
  onChange: (value: string, categoryId?: string) => void;
  placeholder?: string;
  className?: string;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  onBlur?: () => void;
  disabled?: boolean;
  autoFocus?: boolean;
}

const CategoryAutocomplete: React.FC<CategoryAutocompleteProps> = ({
  value,
  onChange,
  placeholder = 'Select or enter a category',
  className = '',
  onKeyDown,
  onBlur,
  disabled = false,
  autoFocus = false,
}) => {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [filteredCategories, setFilteredCategories] = useState<Category[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  // Fetch all categories on component mount
  const fetchCategories = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await categoriesApi.getCategories();
      setCategories(data);
    } catch (err) {
      console.error('Error fetching categories:', err);
      const errorMessage = getErrorMessage(err);
      setError(errorMessage);
      setCategories([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load categories on mount
  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  // Filter categories based on input value
  useEffect(() => {
    if (value.trim() === '') {
      setFilteredCategories(categories);
    } else {
      const query = value.toLowerCase();
      const filtered = categories.filter(category =>
        category.name.toLowerCase().includes(query)
      );
      setFilteredCategories(filtered);
    }
    // Reset selected index when filtered categories change
    setSelectedIndex(-1);
  }, [value, categories]);

  // Handle click outside to close suggestions
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        suggestionsRef.current &&
        !suggestionsRef.current.contains(event.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(event.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
    setShowSuggestions(true);
    setSelectedIndex(-1);
  };

  const handleInputFocus = () => {
    setShowSuggestions(true);
    setSelectedIndex(-1);
  };

  const handleSelectCategory = async (categoryName: string, categoryId?: string) => {
    onChange(categoryName, categoryId);
    setShowSuggestions(false);
    setSelectedIndex(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Handle autocomplete navigation first
    if (showSuggestions) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (filteredCategories.length > 0) {
          setSelectedIndex(prev => (prev < filteredCategories.length - 1 ? prev + 1 : prev));
        }
        return;
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(prev => (prev > 0 ? prev - 1 : prev));
        return;
      } else if (e.key === 'Enter') {
        if (selectedIndex >= 0 && filteredCategories[selectedIndex]) {
          e.preventDefault();
          const category = filteredCategories[selectedIndex];
          handleSelectCategory(category.name, category.id);
          return;
        } else {
          // If no selection and user typed a new category name, allow creating it
          if (value.trim() && !filteredCategories.some(cat => cat.name.toLowerCase() === value.toLowerCase())) {
            // This will create a new category on the fly when the transaction is saved
            onChange(value.trim());
          }
          setShowSuggestions(false);
        }
      } else if (e.key === 'Tab') {
        // If a suggestion is selected, use it
        if (selectedIndex >= 0 && filteredCategories[selectedIndex]) {
          e.preventDefault();
          const category = filteredCategories[selectedIndex];
          handleSelectCategory(category.name, category.id);
          return;
        }
        // Allow normal tab behavior otherwise
        setShowSuggestions(false);
      }
    }

    // Handle Escape to close suggestions
    if (e.key === 'Escape') {
      setShowSuggestions(false);
      setSelectedIndex(-1);
    }

    // Call parent onKeyDown handler if provided
    if (onKeyDown) {
      onKeyDown(e);
    }
  };

  const renderSuggestions = () => {
    if (loading) {
      return (
        <div className="category-suggestion-item loading">
          Loading categories...
        </div>
      );
    }

    if (error) {
      return (
        <div className="category-suggestion-item error">
          {error}
        </div>
      );
    }

    // Show existing categories
    const suggestions = [];
    
    if (filteredCategories.length > 0) {
      suggestions.push(
        <div key="existing" className="category-suggestions-section">
          <div className="category-suggestions-header">Existing Categories</div>
          {filteredCategories.map((category, index) => (
            <div
              key={category.id}
              className={`category-suggestion-item ${index === selectedIndex ? 'selected' : ''}`}
              onClick={() => handleSelectCategory(category.name, category.id)}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              <span className="category-name">{category.name}</span>
            </div>
          ))}
        </div>
      );
    }

    // Show option to create new category if user typed something that doesn't exist
    if (value.trim() && !filteredCategories.some(cat => cat.name.toLowerCase() === value.toLowerCase())) {
      suggestions.push(
        <div key="new" className="category-suggestions-section">
          <div className="category-suggestions-header">Create New</div>
          <div
            className={`category-suggestion-item ${filteredCategories.length === selectedIndex ? 'selected' : ''}`}
            onClick={() => handleSelectCategory(value.trim())}
            onMouseEnter={() => setSelectedIndex(filteredCategories.length)}
          >
            <span className="category-name">Create "{value.trim()}"</span>
            <span className="new-category-indicator">New</span>
          </div>
        </div>
      );
    }

    if (suggestions.length === 0) {
      return (
        <div className="category-suggestion-item">
          No matching categories found
        </div>
      );
    }

    return suggestions;
  };

  return (
    <div className={`category-autocomplete-container ${className}`}>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={handleInputChange}
        onFocus={handleInputFocus}
        onBlur={onBlur}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="category-autocomplete-input"
        autoComplete="off"
        disabled={disabled}
        autoFocus={autoFocus}
      />

      {showSuggestions && (
        <div ref={suggestionsRef} className="category-suggestions">
          {renderSuggestions()}
        </div>
      )}
    </div>
  );
};

export default CategoryAutocomplete;