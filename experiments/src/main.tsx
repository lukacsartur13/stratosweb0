import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { AscentPrototype } from './AscentPrototype';
import { PrototypeFallback } from './components/PrototypeFallback';
import './styles.css';

/**
 * A WebGL scene has more ways to fail at runtime than a document does — a bad
 * driver, a lost context during a resize, a model that decodes wrong. None of
 * them should leave a visitor looking at a blank page, so the whole prototype
 * sits behind a boundary that falls back to the static instrument.
 */
class PrototypeBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Ascent prototype crashed:', error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="ascent" id="main">
        <div className="ascent__stage" style={{ position: 'relative' }}>
          <PrototypeFallback reason="context-lost" />
        </div>
      </main>
    );
  }
}

const host = document.getElementById('root');
if (host) {
  createRoot(host).render(
    <StrictMode>
      <PrototypeBoundary>
        <AscentPrototype />
      </PrototypeBoundary>
    </StrictMode>,
  );
}
