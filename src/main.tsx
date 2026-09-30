import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { AppProvider } from './AppContext';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import { FeedbackProvider } from './components/Feedback';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <HashRouter>
        <FeedbackProvider>
          <AppProvider>
            <App />
          </AppProvider>
        </FeedbackProvider>
      </HashRouter>
    </ErrorBoundary>
  </StrictMode>,
);
