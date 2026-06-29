import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import ErrorBoundary from './ErrorBoundary.jsx';
import './styles.css';

const container = document.getElementById('root');
if (!container) {
  console.error('[Soundforge] #root element not found');
} else {
  try {
    const root = createRoot(container);
    root.render(
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    );
  } catch (err) {
    console.error('[Soundforge] Falha ao montar o app:', err);
    const fallback = document.createElement('pre');
    fallback.style.color = '#f2c1b5';
    fallback.style.padding = '24px';
    fallback.style.fontSize = '13px';
    fallback.textContent = String(err?.message || err);
    container.replaceChildren(fallback);
  }
}
