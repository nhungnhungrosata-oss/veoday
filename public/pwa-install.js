let deferredPrompt;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  // Hiện banner nếu người dùng chưa dismiss hoặc chưa cài đặt PWA
  if (!localStorage.getItem('pwa-dismissed') && !localStorage.getItem('pwa-installed')) {
    setTimeout(showInstallBanner, 3000); // Đợi 3s mới hiện
  }
});

window.addEventListener('appinstalled', () => {
  localStorage.setItem('pwa-installed', 'true');
  hideInstallBanner();
  deferredPrompt = null;
});

function showInstallBanner() {
  const isIOS = navigator.standalone === false && /iP(hone|ad)/.test(navigator.userAgent);
  
  const banner = document.createElement('div');
  banner.id = 'pwa-install-banner';
  banner.style.cssText = `
    position: fixed;
    bottom: 80px;
    left: 16px;
    right: 16px;
    background: #0EA5E9;
    color: white;
    padding: 16px;
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    z-index: 9999;
    font-family: 'Inter', sans-serif;
  `;
  
  if (isIOS) {
    banner.innerHTML = `
      <div style="display: flex; align-items: center; gap: 12px;">
        <div style="background: white; padding: 6px; border-radius: 8px;">
           <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#F5A623" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
        </div>
        <div>
          <h4 style="margin:0; font-size:14px; font-weight:600;">Cài app để dùng offline</h4>
          <p style="margin:4px 0 0; font-size:12px; opacity:0.9;">Nhấn Share → Add to Home Screen</p>
        </div>
      </div>
      <button onclick="document.getElementById('pwa-install-banner').remove(); localStorage.setItem('pwa-dismissed', 'true');" style="background:transparent; border:none; color:white; padding:8px; font-size:16px;">✕</button>
    `;
    document.body.appendChild(banner);
  } else if (deferredPrompt) {
    banner.innerHTML = `
      <div style="display: flex; align-items: center; gap: 12px;">
        <div style="background: white; padding: 6px; border-radius: 8px;">
           <span style="font-size: 20px;">✨</span>
        </div>
        <h4 style="margin:0; font-size:14px; font-weight:600;">Cài app để dùng offline</h4>
      </div>
      <div style="display: flex; gap: 8px;">
        <button id="pwa-install-btn" style="background: #F5A623; color: #0C4A6E; border: none; padding: 8px 16px; border-radius: 8px; font-weight: 600; cursor: pointer;">Cài đặt</button>
        <button onclick="document.getElementById('pwa-install-banner').remove(); localStorage.setItem('pwa-dismissed', 'true');" style="background:transparent; border:none; color:white; padding:8px; font-size:16px;">✕</button>
      </div>
    `;
    document.body.appendChild(banner);
    
    document.getElementById('pwa-install-btn').addEventListener('click', async () => {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        banner.remove();
        localStorage.setItem('pwa-installed', 'true');
      }
      deferredPrompt = null;
    });
  }
}

function hideInstallBanner() {
  const banner = document.getElementById('pwa-install-banner');
  if (banner) banner.remove();
}
