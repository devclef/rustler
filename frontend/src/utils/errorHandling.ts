// Error handling utilities for the ledger application

export interface ApiError {
  message: string;
  status?: number;
  code?: string;
  details?: any;
}

export class LedgerError extends Error {
  public status?: number;
  public code?: string;
  public details?: any;

  constructor(message: string, status?: number, code?: string, details?: any) {
    super(message);
    this.name = 'LedgerError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// Parse error from API response
export const parseApiError = async (response: Response): Promise<LedgerError> => {
  let message = 'An unexpected error occurred';
  let details: any = null;

  try {
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      const errorData = await response.json();
      message = errorData.message || errorData.error || message;
      details = errorData.details || errorData;
    } else {
      message = await response.text() || message;
    }
  } catch (parseError) {
    // If we can't parse the error, use the status text
    message = response.statusText || message;
  }

  return new LedgerError(message, response.status, response.status.toString(), details);
};

// Enhanced fetch wrapper with error handling and retry logic
export const fetchWithRetry = async (
  url: string,
  options: RequestInit = {},
  maxRetries: number = 2,
  retryDelay: number = 1000
): Promise<Response> => {
  let lastError: LedgerError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);
      
      if (!response.ok) {
        const error = await parseApiError(response);
        
        // Don't retry on client errors (4xx) except for 408, 429
        if (response.status >= 400 && response.status < 500 && 
            response.status !== 408 && response.status !== 429) {
          throw error;
        }
        
        // Don't retry on the last attempt
        if (attempt === maxRetries) {
          throw error;
        }
        
        lastError = error;
      } else {
        return response;
      }
    } catch (error) {
      if (error instanceof LedgerError) {
        lastError = error;
      } else {
        lastError = new LedgerError(
          error instanceof Error ? error.message : 'Network error occurred',
          0,
          'NETWORK_ERROR'
        );
      }
      
      // Don't retry on the last attempt
      if (attempt === maxRetries) {
        throw lastError;
      }
    }

    // Wait before retrying
    if (attempt < maxRetries) {
      await new Promise(resolve => setTimeout(resolve, retryDelay * Math.pow(2, attempt)));
    }
  }

  throw lastError!;
};

// User-friendly error messages
export const getErrorMessage = (error: unknown): string => {
  if (error instanceof LedgerError) {
    switch (error.status) {
      case 400:
        return 'Invalid request. Please check your input and try again.';
      case 401:
        return 'You are not authorized to perform this action.';
      case 403:
        return 'Access denied. You do not have permission to perform this action.';
      case 404:
        return 'The requested resource was not found.';
      case 409:
        return 'This action conflicts with existing data. Please refresh and try again.';
      case 422:
        return error.message || 'The data provided is invalid.';
      case 429:
        return 'Too many requests. Please wait a moment and try again.';
      case 500:
        return 'A server error occurred. Please try again later.';
      case 503:
        return 'The service is temporarily unavailable. Please try again later.';
      default:
        return error.message || 'An unexpected error occurred.';
    }
  }
  
  if (error instanceof Error) {
    return error.message;
  }
  
  return 'An unexpected error occurred.';
};

// Check if error is retryable
export const isRetryableError = (error: unknown): boolean => {
  if (error instanceof LedgerError) {
    // Retry on server errors, timeouts, and rate limits
    return error.status === undefined || // Network errors
           error.status >= 500 || // Server errors
           error.status === 408 || // Request timeout
           error.status === 429;   // Too many requests
  }
  
  return true; // Retry network errors by default
};

// Optimistic update utilities
export interface OptimisticUpdate<T> {
  id: string;
  type: 'create' | 'update' | 'delete';
  data: T;
  originalData?: T;
}

export class OptimisticUpdateManager<T extends { id: string }> {
  private updates = new Map<string, OptimisticUpdate<T>>();
  private onStateChange?: (items: T[]) => void;

  constructor(onStateChange?: (items: T[]) => void) {
    this.onStateChange = onStateChange;
  }

  // Apply optimistic update
  applyUpdate(update: OptimisticUpdate<T>, currentItems: T[]): T[] {
    this.updates.set(update.id, update);
    
    let updatedItems = [...currentItems];
    
    switch (update.type) {
      case 'create':
        updatedItems.push(update.data);
        break;
      case 'update':
        updatedItems = updatedItems.map(item => 
          item.id === update.id ? update.data : item
        );
        break;
      case 'delete':
        updatedItems = updatedItems.filter(item => item.id !== update.id);
        break;
    }
    
    if (this.onStateChange) {
      this.onStateChange(updatedItems);
    }
    
    return updatedItems;
  }

  // Confirm successful update
  confirmUpdate(id: string, currentItems: T[]): T[] {
    this.updates.delete(id);
    return currentItems;
  }

  // Revert failed update
  revertUpdate(id: string, currentItems: T[]): T[] {
    const update = this.updates.get(id);
    if (!update) return currentItems;
    
    this.updates.delete(id);
    
    let revertedItems = [...currentItems];
    
    switch (update.type) {
      case 'create':
        revertedItems = revertedItems.filter(item => item.id !== update.id);
        break;
      case 'update':
        if (update.originalData) {
          revertedItems = revertedItems.map(item => 
            item.id === update.id ? update.originalData! : item
          );
        }
        break;
      case 'delete':
        if (update.originalData) {
          revertedItems.push(update.originalData);
        }
        break;
    }
    
    if (this.onStateChange) {
      this.onStateChange(revertedItems);
    }
    
    return revertedItems;
  }

  // Get pending updates
  getPendingUpdates(): OptimisticUpdate<T>[] {
    return Array.from(this.updates.values());
  }

  // Clear all pending updates
  clearUpdates(): void {
    this.updates.clear();
  }
}