import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { ensureDictionaries } from './i18n';
import { setLang } from './lib/i18n';
import { readStoredLang } from './features/i18n/LanguageGate';
import { startTableLabels } from './lib/stackTables';

// This device's last language, and — only if there is one — its translations,
// before the first render, so a chosen language never flashes the source text.
const stored = readStoredLang();
setLang(stored);

const el = document.getElementById('root');
if (!el) throw new Error('#root is missing from index.html');

const start = () => createRoot(el).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

startTableLabels();

if (stored) void ensureDictionaries().finally(start);
else start();
