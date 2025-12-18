import type { LedgerTransaction } from '../services/types';

/**
 * Generate test transaction data for performance testing
 */
export function generateTestTransactions(count: number, accountId: string): LedgerTransaction[] {
  const transactions: LedgerTransaction[] = [];
  const categories = ['Groceries', 'Gas', 'Restaurants', 'Entertainment', 'Utilities', 'Shopping', 'Healthcare', 'Travel'];
  const payees = ['Walmart', 'Shell', 'McDonald\'s', 'Netflix', 'Electric Company', 'Amazon', 'Doctor Office', 'Hotel'];
  
  const startDate = new Date('2020-01-01');
  const endDate = new Date();
  const dateRange = endDate.getTime() - startDate.getTime();
  
  for (let i = 0; i < count; i++) {
    // Generate random date within range
    const randomDate = new Date(startDate.getTime() + Math.random() * dateRange);
    
    // Generate random amount between $1 and $500
    const amount = Math.round((Math.random() * 499 + 1) * 100) / 100;
    
    // Random category and payee
    const category = categories[Math.floor(Math.random() * categories.length)];
    const payee = payees[Math.floor(Math.random() * payees.length)];
    
    // Random transaction type (outflow more common than inflow)
    const isOutflow = Math.random() > 0.3;
    
    // Random cleared status
    const clearedStatuses = ['uncleared', 'cleared', 'reconciled'] as const;
    const clearedStatus = clearedStatuses[Math.floor(Math.random() * clearedStatuses.length)];
    
    // Generate running balance (simplified - just decreasing for outflows, increasing for inflows)
    const runningBalance = 10000 - (i * 10) + (isOutflow ? -amount : amount);
    
    transactions.push({
      id: `test-transaction-${i}`,
      date: randomDate,
      payee: payee,
      category: category,
      cleared_status: clearedStatus,
      outflow: isOutflow ? amount : null,
      inflow: isOutflow ? null : amount,
      runningBalance: runningBalance,
      isTransfer: Math.random() > 0.9, // 10% chance of being a transfer
      memo: `Test transaction ${i + 1}`,
      description: `${payee} - ${category}`,
      amount: amount,
      source_account_id: isOutflow ? accountId : `external-${Math.floor(Math.random() * 100)}`,
      destination_account_id: isOutflow ? `external-${Math.floor(Math.random() * 100)}` : accountId,
      category_id: `category-${Math.floor(Math.random() * categories.length)}`,
      budget_id: null,
      transaction_date: randomDate,
      created_at: randomDate,
      updated_at: randomDate,
    });
  }
  
  // Sort by date (newest first)
  transactions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  
  return transactions;
}

/**
 * Performance measurement utility
 */
export class PerformanceTimer {
  private startTime: number = 0;
  private measurements: { [key: string]: number } = {};
  
  start(label?: string): void {
    this.startTime = performance.now();
    if (label) {
      console.log(`⏱️  Starting: ${label}`);
    }
  }
  
  end(label?: string): number {
    const endTime = performance.now();
    const duration = endTime - this.startTime;
    
    if (label) {
      this.measurements[label] = duration;
      console.log(`✅ Completed: ${label} - ${duration.toFixed(2)}ms`);
    }
    
    return duration;
  }
  
  getMeasurements(): { [key: string]: number } {
    return { ...this.measurements };
  }
  
  logSummary(): void {
    console.log('\n📊 Performance Summary:');
    Object.entries(this.measurements).forEach(([label, duration]) => {
      const status = duration < 100 ? '🟢' : duration < 500 ? '🟡' : '🔴';
      console.log(`${status} ${label}: ${duration.toFixed(2)}ms`);
    });
  }
}

/**
 * Test virtual scrolling performance
 */
export function testVirtualScrollingPerformance(): void {
  const timer = new PerformanceTimer();
  
  console.log('🚀 Starting Virtual Scrolling Performance Test');
  
  // Test with different dataset sizes
  const testSizes = [100, 1000, 5000, 10000];
  
  testSizes.forEach(size => {
    timer.start(`Generate ${size} transactions`);
    const transactions = generateTestTransactions(size, 'test-account');
    timer.end(`Generate ${size} transactions`);
    
    // Simulate rendering time
    timer.start(`Render ${size} transactions (simulated)`);
    // In a real test, this would measure actual DOM rendering
    setTimeout(() => {
      timer.end(`Render ${size} transactions (simulated)`);
    }, 10);
  });
  
  setTimeout(() => {
    timer.logSummary();
    
    // Performance recommendations
    console.log('\n💡 Performance Recommendations:');
    console.log('- Virtual scrolling should be enabled for datasets > 100 transactions');
    console.log('- Target: < 100ms for initial render, < 16ms for scroll updates (60fps)');
    console.log('- Memory usage should remain stable regardless of dataset size');
  }, 100);
}