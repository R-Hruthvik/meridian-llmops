/**
 * Meridian — browser entry point.
 *
 * Mounts the app under the single provider that owns auth (API-key override,
 * tenant scope) and the light/dark theme, and pulls in the design tokens before
 * anything paints.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './styles/tokens.css';
import { AuthProvider } from './core/auth';
import App from './App';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Meridian: #root element not found — check index.html');
}

createRoot(container).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
);
