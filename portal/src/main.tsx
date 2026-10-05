import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { loadDictionaries } from './i18n';
import { setLang } from './lib/i18n';
import { readStoredLang } from './features/i18n/LanguageGate';

// The translations, and this device's last language — before the first render,
// so a chosen language never flashes the source text first.
loadDictionaries();
setLang(readStoredLang());

const el = document.getElementById('root');
if (!el) throw new Error('#root is missing from index.html');

createRoot(el).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
