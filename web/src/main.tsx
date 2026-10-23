import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { SurfaceErrorBoundary } from './components/SurfaceErrorBoundary'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SurfaceErrorBoundary label="Application">
      <App />
    </SurfaceErrorBoundary>
  </StrictMode>,
)
