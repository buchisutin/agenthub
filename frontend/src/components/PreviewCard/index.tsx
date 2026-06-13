import { useMemo, useRef, useState } from 'react';
import { api } from '../../services/api';

function isAllowedPreviewUrl(url: string, port: number) {
  return url === `http://127.0.0.1:${port}`;
}

export function PreviewCard({
  runId,
  initialUrl,
  initialPort,
  onStop,
}: {
  runId: string;
  initialUrl: string;
  initialPort: number;
  onStop?: () => void;
}) {
  const [height, setHeight] = useState(400);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const dragStartRef = useRef<{ y: number; height: number } | null>(null);

  const previewUrl = useMemo(
    () => (isAllowedPreviewUrl(initialUrl, initialPort) ? initialUrl : ''),
    [initialPort, initialUrl],
  );

  function handleDragStart(event: React.MouseEvent<HTMLDivElement>) {
    dragStartRef.current = {
      y: event.clientY,
      height,
    };

    function onMouseMove(moveEvent: MouseEvent) {
      const state = dragStartRef.current;
      if (!state) {
        return;
      }
      const nextHeight = Math.min(800, Math.max(240, state.height + (moveEvent.clientY - state.y)));
      setHeight(nextHeight);
    }

    function onMouseUp() {
      dragStartRef.current = null;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }

  async function handleStop() {
    setStopping(true);
    setError(null);
    try {
      await api.stopRunPreview(runId);
      onStop?.();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to stop preview');
    } finally {
      setStopping(false);
    }
  }

  return (
    <div className="agenthub-card ml-10 overflow-hidden">
      <div className="px-4 py-3 flex items-center justify-between gap-4" style={{ borderBottom: '1px solid var(--app-border)', backgroundColor: 'var(--card-strong)' }}>
        <div className="min-w-0 flex items-center gap-3">
          <div className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium truncate" style={{ color: 'var(--app-text)' }}>
              Preview
            </div>
            <div className="mt-1 text-xs truncate font-mono" style={{ color: 'var(--app-text-secondary)' }}>
              {previewUrl || `http://127.0.0.1:${initialPort}`}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {previewUrl && (
            <a
              href={previewUrl}
              target="_blank"
              rel="noreferrer"
              className="px-3 py-2 rounded-lg text-sm font-medium"
              style={{ backgroundColor: 'var(--card-bg)', color: 'var(--status-running)', border: '1px solid var(--app-border)' }}
            >
              Open in New Tab
            </a>
          )}
          <button
            type="button"
            disabled={stopping}
            onClick={() => void handleStop()}
            className="px-3 py-2 rounded-lg text-sm font-medium"
            style={{
              backgroundColor: stopping ? 'var(--card-strong)' : 'rgba(220, 38, 38, 0.08)',
              color: stopping ? 'var(--app-text-secondary)' : 'var(--status-danger)',
              border: '1px solid rgba(220, 38, 38, 0.18)',
            }}
          >
            {stopping ? 'Stopping...' : 'Stop'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mx-4 mt-4 rounded-lg px-3 py-2 text-sm" style={{ backgroundColor: 'rgba(220, 38, 38, 0.08)', border: '1px solid rgba(220, 38, 38, 0.18)', color: 'var(--status-danger)' }}>
          {error}
        </div>
      )}

      {previewUrl ? (
        <div className="p-4">
          {loading && (
            <div className="mb-3 h-10 animate-pulse rounded-lg" style={{ backgroundColor: 'var(--card-strong)' }} />
          )}
          <iframe
            title={`preview-${runId}`}
            src={previewUrl}
            onLoad={() => setLoading(false)}
            style={{ width: '100%', height: `${height}px`, border: 'none', backgroundColor: '#FFFFFF' }}
            sandbox="allow-scripts allow-same-origin"
          />
          <div
            role="separator"
aria-label="Resize preview height"
            onMouseDown={handleDragStart}
            className="mt-2 h-3 cursor-row-resize rounded"
            style={{ backgroundColor: 'var(--app-border-strong)' }}
          />
        </div>
      ) : (
        <div className="m-4 rounded-xl p-4 text-sm font-mono" style={{ backgroundColor: '#0a0a0a', color: 'var(--status-danger)' }}>
          Invalid preview URL. Only 127.0.0.1 local addresses are supported.
        </div>
      )}
    </div>
  );
}
