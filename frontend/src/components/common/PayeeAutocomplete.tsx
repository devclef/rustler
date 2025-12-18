import { useState, useEffect, useRef, useCallback } from 'react';
import { enhancedApi } from '../../services/enhancedApi';
import { getErrorMessage } from '../../utils/errorHandling';
import type { PayeeAutocompleteResponse, AccountSuggestion } from '../../services/api';
import './PayeeAutocomplete.css';

interface PayeeAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onCategoryAutoFill?: (categoryId: string | null, categoryName: string | null) => void;
  placeholder?: string;
  className?: string;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  onBlur?: () => void;
  disabled?: boolean;
  autoFocus?: boolean;
}

const PayeeAutocomplete: React.FC<PayeeAutocompleteProps> = ({
  value,
  onChange,
  onCategoryAutoFill,
  placeholder = 'Select or enter a payee',
  className = '',
  onKeyDown,
  onBlur,
  disabled = false,
  autoFocus = false,
}) => {
  const [suggestions, setSuggestions] = useState<PayeeAutocompleteResponse>({ accounts: [], external_payees: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [filteredSuggestions, setFilteredSuggestions] = useState<PayeeAutocompleteResponse>({ accounts: [], external_payees: [] });
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  // Debounced fetch function
  const fetchSuggestions = useCallback(async (query: string) => {
    try {
      setLoading(true);
      setError(null);
      const data = await enhancedApi.getPayeeAutocomplete(query.trim() || undefined);
      setSuggestions(data);
    } catch (err) {
      console.error('Error fetching payee suggestions:', err);
      const errorMessage = getErrorMessage(err);
      setError(errorMessage);
      setSuggestions({ accounts: [], external_payees: [] });
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounce the API calls
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (showSuggestions) {
        fetchSuggestions(value);
      }
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [value, showSuggestions, fetchSuggestions]);

  // Filter suggestions based on input value
  useEffect(() => {
    if (value.trim() === '') {
      setFilteredSuggestions(suggestions);
    } else {
      const query = value.toLowerCase();
      const filteredAccounts = suggestions.accounts.filter(account =>
        account.name.toLowerCase().includes(query)
      );
      const filteredExternalPayees = suggestions.external_payees.filter(payee =>
        payee.toLowerCase().includes(query)
      );
      setFilteredSuggestions({
        accounts: filteredAccounts,
        external_payees: filteredExternalPayees
      });
    }
    // Reset selected index when filtered suggestions change
    setSelectedIndex(-1);
  }, [value, suggestions]);

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

  const handleSelectPayee = async (payeeName: string) => {
    onChange(payeeName);
    setShowSuggestions(false);
    setSelectedIndex(-1);

    // Auto-fill category if callback is provided
    if (onCategoryAutoFill) {
      try {
        const lastCategory = await enhancedApi.getLastCategory(payeeName);
        onCategoryAutoFill(lastCategory.category_id, lastCategory.category_name);
      } catch (err) {
        console.error('Error fetching last category for payee:', err);
        // Don't show error to user, just skip auto-fill
      }
    }
  };

  // Get all suggestions as a flat array for keyboard navigation
  const getAllSuggestions = () => {
    const allSuggestions: Array<{ type: 'account' | 'external'; name: string; data?: AccountSuggestion }> = [];
    
    filteredSuggestions.accounts.forEach(account => {
      allSuggestions.push({ type: 'account', name: account.name, data: account });
    });
    
    filteredSuggestions.external_payees.forEach(payee => {
      allSuggestions.push({ type: 'external', name: payee });
    });
    
    return allSuggestions;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Handle autocomplete navigation first
    if (showSuggestions) {
      const allSuggestions = getAllSuggestions();

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (allSuggestions.length > 0) {
          setSelectedIndex(prev => (prev < allSuggestions.length - 1 ? prev + 1 : prev));
        }
        return;
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(prev => (prev > 0 ? prev - 1 : prev));
        return;
      } else if (e.key === 'Enter') {
        if (selectedIndex >= 0 && allSuggestions[selectedIndex]) {
          e.preventDefault();
          handleSelectPayee(allSuggestions[selectedIndex].name);
          return;
        }
        // If no selection, close suggestions and let parent handle Enter
        setShowSuggestions(false);
      } else if (e.key === 'Tab') {
        // If a suggestion is selected, use it
        if (selectedIndex >= 0 && allSuggestions[selectedIndex]) {
          e.preventDefault();
          handleSelectPayee(allSuggestions[selectedIndex].name);
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
        <div className="payee-suggestion-item loading">
          Loading payees...
        </div>
      );
    }

    if (error) {
      return (
        <div className="payee-suggestion-item error">
          {error}
        </div>
      );
    }

    const allSuggestions = getAllSuggestions();
    
    if (allSuggestions.length === 0) {
      return (
        <div className="payee-suggestion-item">
          No matching payees found
        </div>
      );
    }

    let currentIndex = 0;
    const sections = [];

    // Render accounts section
    if (filteredSuggestions.accounts.length > 0) {
      sections.push(
        <div key="accounts" className="payee-suggestions-section">
          <div className="payee-suggestions-header">Accounts</div>
          {filteredSuggestions.accounts.map((account) => (
            <div
              key={`account-${account.id}`}
              className={`payee-suggestion-item ${currentIndex === selectedIndex ? 'selected' : ''}`}
              onClick={() => handleSelectPayee(account.name)}
              onMouseEnter={() => setSelectedIndex(currentIndex++)}
            >
              <span className="payee-name">{account.name}</span>
              <span className="account-type-indicator">{account.account_type}</span>
            </div>
          ))}
        </div>
      );
      // Update currentIndex after accounts
      currentIndex = filteredSuggestions.accounts.length;
    }

    // Render external payees section
    if (filteredSuggestions.external_payees.length > 0) {
      sections.push(
        <div key="external" className="payee-suggestions-section">
          <div className="payee-suggestions-header">External Payees</div>
          {filteredSuggestions.external_payees.map((payee, index) => (
            <div
              key={`external-${payee}`}
              className={`payee-suggestion-item ${(currentIndex + index) === selectedIndex ? 'selected' : ''}`}
              onClick={() => handleSelectPayee(payee)}
              onMouseEnter={() => setSelectedIndex(currentIndex + index)}
            >
              <span className="payee-name">{payee}</span>
              <span className="external-payee-indicator">External</span>
            </div>
          ))}
        </div>
      );
    }

    return sections;
  };

  return (
    <div className={`payee-autocomplete-container ${className}`}>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={handleInputChange}
        onFocus={handleInputFocus}
        onBlur={onBlur}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="payee-autocomplete-input"
        autoComplete="off"
        disabled={disabled}
        autoFocus={autoFocus}
      />

      {showSuggestions && (
        <div ref={suggestionsRef} className="payee-suggestions">
          {renderSuggestions()}
        </div>
      )}
    </div>
  );
};

export default PayeeAutocomplete;