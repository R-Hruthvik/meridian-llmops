import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { DesignPreview } from './components/DesignPreview'

const previewOnly = new URLSearchParams(window.location.search).has('design-preview')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {previewOnly ? <DesignPreview /> : <App />}
  </StrictMode>,
)
