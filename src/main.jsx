import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { setupAutoUpdate } from './lib/pwa.js';
import './styles.css';

setupAutoUpdate();

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
