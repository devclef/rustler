import React from 'react';
import { getErrorMessage, isRetryableError } from '../../utils/errorHandling';
import './ErrorDisplay.css';

interface ErrorDisplayProps {
  error: unknown;
  onRetry?: () => void;
  onDismiss?: () => void;
  title?: string;
  className?: string;
  variant?: 'inline' | 'banner' | 'modal';
  showRetry?: boolean;
}

const ErrorDisplay: React.FC<ErrorDisplayProps> = ({
  error,
  onRetry,
  onDismiss,
  title = 'Error',
  className = '',
  variant = 'inline',
  showRetry = true,
}) => {
  const errorMessage = getErrorMessage(error);
  const canRetry = showRetry && isRetryableError(error) && onRetry;

  const errorContent = (
    <div className={`error-display ${variant} ${className}`}>
      <div className="error-icon">
        ⚠️
      </div>
      <div className="error-content">
        <div className="error-title">{title}</div>
        <div className="error-message">{errorMessage}</div>
        <div className="error-actions">
          {canRetry && (
            <button 
              onClick={onRetry} 
              className="error-retry-btn"
              type="button"
            >
              Try Again
            </button>
          )}
          {onDismiss && (
            <button 
              onClick={onDismiss} 
              className="error-dismiss-btn"
              type="button"
            >
              Dismiss
            </button>
          )}
        </div>
      </div>
      {onDismiss && (
        <button 
          onClick={onDismiss} 
          className="error-close-btn"
          type="button"
          aria-label="Close error"
        >
          ×
        </button>
      )}
    </div>
  );

  if (variant === 'modal') {
    return (
      <div className="error-modal-overlay">
        {errorContent}
      </div>
    );
  }

  return errorContent;
};

export default ErrorDisplay;