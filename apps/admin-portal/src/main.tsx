import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './app/App';
import { ServicesProvider, useBrowserServices } from './app/services';
import { I18nProvider } from './i18n';
import './styles.css';

function Root() {
  const services = useBrowserServices();
  return (
    <ServicesProvider services={services}>
      <I18nProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </I18nProvider>
    </ServicesProvider>
  );
}

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');
createRoot(container).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
