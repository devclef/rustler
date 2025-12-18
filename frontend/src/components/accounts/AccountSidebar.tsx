import { useState, useEffect } from 'react';
import { accountsApi } from '../../services/api';
import type { Account } from '../../services/api';
import { ACCOUNT_TYPE } from '../../constants/accountTypes';

interface AccountSidebarProps {
  selectedAccountId: string | null;
  onSelectAccount: (accountId: string) => void;
}

const AccountSidebar = ({ selectedAccountId, onSelectAccount }: AccountSidebarProps) => {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    console.log('AccountSidebar: useEffect triggered');

    const fetchAccounts = async () => {
      try {
        setLoading(true);
        console.log('AccountSidebar: Fetching accounts data...');
        const data = await accountsApi.getAccounts();
        console.log('AccountSidebar: Accounts data received:', data);

        // Filter out external accounts, only show on-budget and off-budget accounts
        // Use startsWith to include accounts with subtypes
        const filteredAccounts = data.filter(account =>
          account.account_type.startsWith(ACCOUNT_TYPE.ON_BUDGET) ||
          account.account_type.startsWith(ACCOUNT_TYPE.OFF_BUDGET)
        );

        console.log('AccountSidebar: Setting filtered accounts:', filteredAccounts);
        setAccounts(filteredAccounts);

        setLoading(false);
      } catch (err) {
        setError('Failed to fetch accounts. Please try again later.');
        setLoading(false);
        console.error('Error fetching accounts:', err);
      }
    };

    fetchAccounts();
  }, []);

  if (loading) {
    return <div className="account-sidebar-loading">Loading accounts...</div>;
  }

  if (error) {
    return <div className="account-sidebar-error">{error}</div>;
  }

  if (accounts.length === 0) {
    return (
      <div className="account-sidebar-empty">
        <p>No accounts found.</p>
        <a href="/accounts/new" className="button">Create Account</a>
      </div>
    );
  }

  // Group accounts by budget status
  // Use startsWith to include accounts with subtypes
  const onBudgetAccounts = accounts.filter(account => account.account_type.startsWith(ACCOUNT_TYPE.ON_BUDGET));
  const offBudgetAccounts = accounts.filter(account => account.account_type.startsWith(ACCOUNT_TYPE.OFF_BUDGET));

  // Render account list item
  const renderAccountItem = (account: Account) => (
    <li
      key={account.id}
      className={`account-item ${selectedAccountId === account.id ? 'selected' : ''}`}
      onClick={() => onSelectAccount(account.id)}
    >
      <div className="account-name">{account.name}</div>
      <div className={`account-balance ${account.balance >= 0 ? 'positive' : 'negative'}`}>
        {account.balance.toFixed(2)}
      </div>
    </li>
  );

  return (
    <div className="account-sidebar">
      <h2>Accounts</h2>

      {/* On Budget Accounts */}
      {onBudgetAccounts.length > 0 && (
        <>
          <h3 className="account-group-heading">On Budget</h3>
          <ul className="account-list">
            {onBudgetAccounts.map(renderAccountItem)}
          </ul>
        </>
      )}

      {/* Off Budget Accounts */}
      {offBudgetAccounts.length > 0 && (
        <>
          <h3 className="account-group-heading">Off Budget</h3>
          <ul className="account-list">
            {offBudgetAccounts.map(renderAccountItem)}
          </ul>
        </>
      )}

      <div className="account-sidebar-actions">
        <a href="/accounts/new" className="button">Add Account</a>
      </div>
    </div>
  );
};

export default AccountSidebar;
