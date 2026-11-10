import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './index.css';
import App from './App.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <div className="atmos-layers">
      <div className="atmos-grid" aria-hidden="true" />
      <div className="atmos-grain" aria-hidden="true" />
    </div>
    <App />
  </StrictMode>,
);
