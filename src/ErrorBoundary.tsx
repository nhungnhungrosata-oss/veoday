import React from 'react';

type Props = { children: React.ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[App crash]', error, info);
  }

  private resetApp = async () => {
    try {
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      }
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((reg) => reg.unregister()));
      }
    } catch (err) {
      console.warn('[resetApp]', err);
    } finally {
      window.location.reload();
    }
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, fontFamily: 'system-ui, sans-serif' }}>
        <section style={{ maxWidth: 520, border: '1px solid #e5e7eb', borderRadius: 16, padding: 24, boxShadow: '0 10px 30px rgba(0,0,0,.08)' }}>
          <h1 style={{ margin: '0 0 8px', fontSize: 22 }}>Ứng dụng gặp lỗi khi tải</h1>
          <p style={{ color: '#4b5563', lineHeight: 1.6 }}>
            Mình đã chặn màn hình trắng. Bấm nút bên dưới để xóa cache/service worker cũ rồi tải lại bản mới nhất.
          </p>
          <pre style={{ whiteSpace: 'pre-wrap', background: '#f9fafb', padding: 12, borderRadius: 10, color: '#991b1b', fontSize: 12 }}>
            {this.state.error.message}
          </pre>
          <button onClick={this.resetApp} style={{ marginTop: 12, padding: '10px 14px', borderRadius: 10, border: 0, background: '#0ea5e9', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>
            Xóa cache và tải lại
          </button>
        </section>
      </main>
    );
  }
}
