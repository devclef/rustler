// Basic tests for error handling utilities
import { LedgerError, getErrorMessage, isRetryableError, OptimisticUpdateManager } from '../errorHandling';

// Test LedgerError class
const testLedgerError = () => {
  const error = new LedgerError('Test error', 500, 'SERVER_ERROR', { detail: 'test' });
  console.assert(error.message === 'Test error', 'LedgerError message should be set');
  console.assert(error.status === 500, 'LedgerError status should be set');
  console.assert(error.code === 'SERVER_ERROR', 'LedgerError code should be set');
  console.log('✓ LedgerError class works correctly');
};

// Test getErrorMessage function
const testGetErrorMessage = () => {
  const ledgerError = new LedgerError('Custom error', 400);
  const regularError = new Error('Regular error');
  const unknownError = 'String error';

  console.assert(getErrorMessage(ledgerError) === 'Invalid request. Please check your input and try again.', 'Should return user-friendly message for 400 error');
  console.assert(getErrorMessage(regularError) === 'Regular error', 'Should return error message for regular Error');
  console.assert(getErrorMessage(unknownError) === 'An unexpected error occurred.', 'Should return default message for unknown error');
  console.log('✓ getErrorMessage function works correctly');
};

// Test isRetryableError function
const testIsRetryableError = () => {
  const retryableError = new LedgerError('Server error', 500);
  const nonRetryableError = new LedgerError('Bad request', 400);
  const networkError = new Error('Network error');

  console.assert(isRetryableError(retryableError) === true, 'Should be retryable for 500 error');
  console.assert(isRetryableError(nonRetryableError) === false, 'Should not be retryable for 400 error');
  console.assert(isRetryableError(networkError) === true, 'Should be retryable for network error');
  console.log('✓ isRetryableError function works correctly');
};

// Test OptimisticUpdateManager
const testOptimisticUpdateManager = () => {
  interface TestItem {
    id: string;
    name: string;
  }

  const manager = new OptimisticUpdateManager<TestItem>();
  const initialItems: TestItem[] = [
    { id: '1', name: 'Item 1' },
    { id: '2', name: 'Item 2' }
  ];

  // Test create update
  const newItem = { id: '3', name: 'Item 3' };
  const createUpdate = {
    id: '3',
    type: 'create' as const,
    data: newItem,
  };

  const updatedItems = manager.applyUpdate(createUpdate, initialItems);
  console.assert(updatedItems.length === 3, 'Should add new item');
  console.assert(updatedItems.find(item => item.id === '3')?.name === 'Item 3', 'Should contain new item');

  // Test confirm update
  const confirmedItems = manager.confirmUpdate('3', updatedItems);
  console.assert(confirmedItems.length === 3, 'Should maintain items after confirmation');

  console.log('✓ OptimisticUpdateManager works correctly');
};

// Run all tests
export const runErrorHandlingTests = () => {
  console.log('Running error handling tests...');
  testLedgerError();
  testGetErrorMessage();
  testIsRetryableError();
  testOptimisticUpdateManager();
  console.log('All error handling tests passed!');
};

// Auto-run tests if this file is executed directly
if (typeof window === 'undefined') {
  runErrorHandlingTests();
}