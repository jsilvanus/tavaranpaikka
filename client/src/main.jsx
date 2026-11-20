import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './styles/global.css';
import App from './App.jsx';
import { getBasePath } from './api/client.js';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter basename={getBasePath() || '/'}>
      <App />
    </BrowserRouter>
  </StrictMode>
);
