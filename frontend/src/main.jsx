import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ErrorBoundary from './ErrorBoundary';
import './index.css';

// Global unhandled promise rejection handler — catches async errors
// that React ErrorBoundary cannot (e.g. failed fetch calls, timers)
window.addEventListener('unhandledrejection', (event) => {
  console.error('[Unhandled Promise Rejection]', event.reason);
  // Prevent the default browser behavior (console error spam)
  event.preventDefault();
});

// Global error handler — catches errors not inside React tree
window.addEventListener('error', (event) => {
  console.error('[Global Error]', event.error || event.message);
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <ErrorBoundary fallbackTitle="RHoSAM Hotel — Unexpected Error">
    <React.StrictMode>
      <App />
    </React.StrictMode>
  </ErrorBoundary>
);
