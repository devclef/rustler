import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import AccountSidebar from './accounts/AccountSidebar';
import LedgerTable from './ledger/LedgerTable';

// Key for storing the selected account ID in localStorage
const SELECTED_ACCOUNT_KEY = 'rustler_selected_account_id';

const LedgerLayout = () => {
  const location = useLocation();

  // Initialize with the stored account ID from localStorage, or null if not found
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(() => {
    const storedAccountId = localStorage.getItem(SELECTED_ACCOUNT_KEY);
    return storedAccountId || null;
  });

  // Note: LedgerTable handles its own refresh logic internally

  // Handle refresh signals from navigation
  useEffect(() => {
    if (location.state && location.state.refresh) {
      console.log('LedgerLayout: Refresh signal received', location.state);

      // Clear the location state to prevent refreshing on subsequent renders
      // Note: LedgerTable handles its own refresh logic internally
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  const handleSelectAccount = (accountId: string) => {
    // Update state
    setSelectedAccountId(accountId);

    // Store in localStorage for persistence
    localStorage.setItem(SELECTED_ACCOUNT_KEY, accountId);
  };

  return (
    <div className="ledger-layout">
      <aside className="ledger-sidebar">
        <AccountSidebar
          selectedAccountId={selectedAccountId}
          onSelectAccount={handleSelectAccount}
        />
      </aside>
      <main className="ledger-content">
        {selectedAccountId ? (
          <LedgerTable accountId={selectedAccountId} />
        ) : (
          <div className="no-account-selected">
            <div className="empty-state">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M19 5H5C3.89543 5 3 5.89543 3 7V17C3 18.1046 3.89543 19 5 19H19C20.1046 19 21 18.1046 21 17V7C21 5.89543 20.1046 5 19 5Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M3 7L12 13L21 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <h3>No Account Selected</h3>
              <p>Please select an account from the sidebar to view transactions.</p>
              <p className="help-text">You can choose from both On Budget and Off Budget accounts listed in the sidebar.</p>
            </div>
          </div>
        )}
      </main>
      <button className="toggle-sidebar-button" onClick={() => document.body.classList.toggle('sidebar-collapsed')} aria-label="Toggle sidebar">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M4 6H20M4 12H20M4 18H20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
    </div>
  );
};

export default LedgerLayout;
