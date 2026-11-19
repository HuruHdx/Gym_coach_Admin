import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { FeedbackHost } from './feedback'
import './styles/tokens.css'
import './styles/global.css'

document.documentElement.dataset.theme = 'forge'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
      <FeedbackHost />
    </BrowserRouter>
  </StrictMode>,
)
