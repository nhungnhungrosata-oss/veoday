// Cache/SW cleanup only. This app intentionally does NOT register a Service Worker
// because old SW caches caused blank screens after deploys.
(async function cleanupServiceWorkersAndCaches() {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((reg) => reg.unregister()));
    }

    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }

    // Remove non-HttpOnly cookies created on this origin. HttpOnly cookies cannot be
    // deleted from browser JS, but this app does not create cookies itself.
    document.cookie.split(';').forEach((cookie) => {
      const name = cookie.split('=')[0]?.trim();
      if (!name) return;
      document.cookie = `${name}=; Max-Age=0; path=/; SameSite=Lax`;
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
    });
  } catch (err) {
    console.warn('[startup cleanup] Could not clear old cache/SW/cookies:', err);
  }
})();
