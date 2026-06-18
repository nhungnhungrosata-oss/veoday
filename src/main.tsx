import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import LicenseGate from './LicenseGate';
import './index.css';

const rootEl = document.getElementById('root');
if (!rootEl) {
  document.body.innerHTML = '<main style="padding:24px;font-family:system-ui,sans-serif">Không tìm thấy #root để khởi động ứng dụng.</main>';
} else {
  createRoot(rootEl).render(
    <StrictMode>
      <LicenseGate>
        <App />
      </LicenseGate>
    </StrictMode>,
  );
}
