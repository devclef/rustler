import type { LedgerTransaction } from './types';

/**
 * Running Balance Calculation Utility
 * 
 * This utility calculates running balances for transactions in a ledger view.
 * The running balance represents the account balance after each transaction
 * was processed, working backwards from the current account balance.
 * 
 * Usage:
 * ```typescript
 * import { calculateRunningBalances } from './services/runningBalance';
 * 
 * const balances = calculateRunningBalances(transactions, currentBalance);
 * // or use the combined function:
 * calculateAndApplyRunningBalances(transactions, currentBalance);
 * ```
 */

/**
 * Calculate running balances for transactions in a ledger view
 * 
 * @param transactions Array of ledger transactions
 * @param currentBalance Current account balance (most recent balance)
 * @returns Map of transaction ID to running balance
 */
export function calculateRunningBalances(
  transactions: LedgerTransaction[],
  currentBalance: number
): Map<string, number> {
  const runningBalances = new Map<string, number>();
  
  // If no transactions, return empty map
  if (transactions.length === 0) {
    return runningBalances;
  }
  
  // Sort transactions by date (newest first) to work backwards from current balance
  const sortedTransactions = [...transactions].sort((a, b) => {
    const dateA = new Date(a.date);
    const dateB = new Date(b.date);
    return dateB.getTime() - dateA.getTime();
  });
  
  // Start with current balance and work backwards
  let runningBalance = currentBalance;
  
  // For each transaction (newest to oldest), calculate what the balance was before it
  for (const transaction of sortedTransactions) {
    // The running balance for this transaction is the balance after it was applied
    runningBalances.set(transaction.id, runningBalance);
    
    // Calculate the balance before this transaction by reversing its effect
    // If money flowed into the account (inflow), subtract it to get previous balance
    // If money flowed out of the account (outflow), add it back to get previous balance
    if (transaction.inflow !== null) {
      runningBalance -= transaction.inflow;
    } else if (transaction.outflow !== null) {
      runningBalance += transaction.outflow;
    }
  }
  
  return runningBalances;
}

/**
 * Apply running balances to transactions array (mutates the array)
 * 
 * @param transactions Array of ledger transactions to update
 * @param runningBalances Map of transaction ID to running balance
 */
export function applyRunningBalances(
  transactions: LedgerTransaction[],
  runningBalances: Map<string, number>
): void {
  for (const transaction of transactions) {
    const balance = runningBalances.get(transaction.id);
    if (balance !== undefined) {
      transaction.running_balance = balance;
    }
  }
}

/**
 * Calculate and apply running balances to transactions in one step
 * 
 * @param transactions Array of ledger transactions to update (mutated)
 * @param currentBalance Current account balance
 * @returns The updated transactions array (same reference as input)
 */
export function calculateAndApplyRunningBalances(
  transactions: LedgerTransaction[],
  currentBalance: number
): LedgerTransaction[] {
  const runningBalances = calculateRunningBalances(transactions, currentBalance);
  applyRunningBalances(transactions, runningBalances);
  return transactions;
}