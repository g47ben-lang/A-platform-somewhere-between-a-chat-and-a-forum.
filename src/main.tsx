import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerServiceWorker } from './lib/push';
import { HashRouter } from 'react-router-dom';
import { AppProvider } from './AppContext';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import { FeedbackProvider } from './components/Feedback';
import { ProfileCardProvider } from './components/ProfileCard';
import './styles.css';

registerServiceWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <HashRouter>
        <FeedbackProvider>
          <AppProvider>
            <ProfileCardProvider>
              <App />
            </ProfileCardProvider>
          </AppProvider>
        </FeedbackProvider>
      </HashRouter>
    </ErrorBoundary>
  </StrictMode>,
);
