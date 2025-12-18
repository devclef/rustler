import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { SettingsProvider } from './contexts/SettingsContext'
import { registerServiceWorker, requestNotificationPermission } from './serviceWorkerRegistration'

// Register service worker for PWA functionality
registerServiceWorker();

// Request notification permission
requestNotificationPermission();

const rootEl = document.getElementById('root');

function showFatalError(message: string) {
  const el = document.getElementById('root') || document.body;
  el.innerHTML = `
    <div style="padding:16px;font-family:sans-serif;color:#b00020">
      <h2>Something went wrong</h2>
      <p>${message}</p>
      <p>Try reloading the app. If the problem persists on Android PWA, long‑press the app icon, tap App info, then Storage & cache → Clear storage.</p>
    </div>
  `;
}

window.addEventListener('unhandledrejection', (e) => {
  console.error('Unhandled promise rejection', e.reason);
  showFatalError('A runtime error occurred.');
});

window.addEventListener('error', (e) => {
  console.error('Unhandled error', e.error || e.message);
  showFatalError('An unexpected error occurred.');
});

if (rootEl) {
  try {
    createRoot(rootEl).render(
      <StrictMode>
        <SettingsProvider>
          <App />
        </SettingsProvider>
      </StrictMode>
    );
  } catch (e) {
    console.error('Failed to mount application', e);
    showFatalError('Failed to start the application.');
  }
} else {
  console.error('Root element not found');
  showFatalError('Application root container not found.');
}
