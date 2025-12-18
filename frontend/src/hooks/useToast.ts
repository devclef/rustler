import { useState, useCallback } from 'react';
import type { ToastMessage } from '../components/common/Toast';

export const useToast = () => {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addToast = useCallback((
    message: string,
    type: ToastMessage['type'] = 'info',
    options?: {
      duration?: number;
      action?: ToastMessage['action'];
    }
  ) => {
    const id = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    const toast: ToastMessage = {
      id,
      message,
      type,
      duration: options?.duration,
      action: options?.action,
    };

    setToasts(prev => [...prev, toast]);
    return id;
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(toast => toast.id !== id));
  }, []);

  const clearAllToasts = useCallback(() => {
    setToasts([]);
  }, []);

  // Convenience methods
  const showSuccess = useCallback((message: string, options?: { duration?: number; action?: ToastMessage['action'] }) => {
    return addToast(message, 'success', options);
  }, [addToast]);

  const showError = useCallback((message: string, options?: { duration?: number; action?: ToastMessage['action'] }) => {
    return addToast(message, 'error', { duration: 0, ...options }); // Errors don't auto-dismiss by default
  }, [addToast]);

  const showWarning = useCallback((message: string, options?: { duration?: number; action?: ToastMessage['action'] }) => {
    return addToast(message, 'warning', options);
  }, [addToast]);

  const showInfo = useCallback((message: string, options?: { duration?: number; action?: ToastMessage['action'] }) => {
    return addToast(message, 'info', options);
  }, [addToast]);

  return {
    toasts,
    addToast,
    removeToast,
    clearAllToasts,
    showSuccess,
    showError,
    showWarning,
    showInfo,
  };
};