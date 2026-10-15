import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './reader.css'
import App from './ReaderApp.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
