import React from 'react';

import { SurfaceErrorBoundary } from './components/SurfaceErrorBoundary';
import { HomePage } from './pages/HomePage';

export const App: React.FC = () => (
  <SurfaceErrorBoundary label="Application">
    <HomePage />
  </SurfaceErrorBoundary>
);

export default App;
