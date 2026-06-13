import { useEffect } from 'react';
import { useApp } from '../../store/useApp';

export function Toast() {
  const { state, dispatch } = useApp();

  useEffect(() => {
    if (state.error) {
      const t = setTimeout(() => dispatch({ type: 'CLEAR_ERROR' }), 4000);
      return () => clearTimeout(t);
    }
  }, [state.error, dispatch]);

  if (!state.error) return null;

  return (
    <div
      className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg text-sm"
      style={{ backgroundColor: 'var(--color-elevated)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
    >
      <span className="text-red-400">⚠️</span>
      <span>{state.error}</span>
      <button
        onClick={() => dispatch({ type: 'CLEAR_ERROR' })}
        className="ml-2 opacity-60 hover:opacity-100"
      >
        ✕
      </button>
    </div>
  );
}

export function ConnectionBanner() {
  const { state } = useApp();

  if (state.selectedConvId && !state.connected) {
    return (
      <div className="px-4 py-2 text-sm text-center" style={{ backgroundColor: '#D97706', color: '#fff' }}>
        连接已断开，正在重连...
      </div>
    );
  }

  return null;
}
