import { useEffect, useMemo, useState } from 'react';
import { api } from '../../services/api';
import type { DeployRecord, DeployScriptsResponse } from '../../types';
import { Badge } from '../ui/Badge';

function statusLabel(status: DeployRecord['status']) {
  if (status === 'succeeded') return 'Deploy succeeded';
  if (status === 'failed') return 'Deploy failed';
  if (status === 'running') return 'Deploy running';
  return 'Deploy';
}

function statusVariant(status: DeployRecord['status']) {
  if (status === 'succeeded') return 'completed';
  if (status === 'failed') return 'failed';
  if (status === 'running') return 'running';
  return 'muted';
}

export function DeployCard({ runId }: { runId: string }) {
  const [scriptsResult, setScriptsResult] = useState<{
    runId: string;
    data: DeployScriptsResponse | null;
    error: string | null;
  }>({ runId: '', data: null, error: null });
  const [deploy, setDeploy] = useState<DeployRecord | null>(null);
  const [starting, setStarting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.getRunDeployScripts(runId)
      .then((nextScripts) => {
        if (cancelled) return;
        setScriptsResult({ runId, data: nextScripts, error: null });
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setScriptsResult({
            runId,
            data: null,
            error: e instanceof Error ? e.message : '加载 Deploy scripts 失败',
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [runId]);

  useEffect(() => {
    if (!deploy || deploy.status !== 'running') return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      api.getRunDeploy(runId)
        .then((nextDeploy) => {
          if (!cancelled) setDeploy(nextDeploy);
        })
        .catch(() => undefined);
    }, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [deploy, runId]);

  const logText = useMemo(
    () => deploy?.logs.map((entry) => entry.chunk).join('').trimEnd() ?? '',
    [deploy],
  );
  const loadingScripts = scriptsResult.runId !== runId;
  const scripts = loadingScripts ? null : scriptsResult.data;
  const error = actionError ?? (loadingScripts ? null : scriptsResult.error);
  const deployScript = scripts?.scripts.includes('build')
    ? 'build'
    : scripts?.defaultScript ?? scripts?.scripts[0] ?? 'build';
  const commandLabel = deploy?.command ?? (deployScript ? `npm run ${deployScript}` : 'package.json scripts');
  const showTerminal = starting || deploy?.status === 'running' || logText.length > 0;

  async function handleRunDeploy() {
    setStarting(true);
    setActionError(null);
    try {
      const started = await api.startRunDeploy(runId, deployScript);
      setDeploy(started);
      const latest = await api.getRunDeploy(runId);
      if (latest) setDeploy(latest);
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : 'Deploy failed');
    } finally {
      setStarting(false);
    }
  }

  const canRun = Boolean(scripts?.scripts.length) && !starting && deploy?.status !== 'running';

  return (
    <div>
      <div
        className="mt-3 flex items-center justify-between gap-4 rounded-lg px-4 py-3"
        style={{
          backgroundColor: '#FFFFFF',
          border: '0.5px solid var(--app-border)',
          boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
        }}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="font-mono text-xs" style={{ color: 'var(--app-text-secondary)' }}>
            &gt;_
          </span>
          <span className="text-xs" style={{ color: 'var(--app-text-secondary)' }}>
            Detected script:
          </span>
          <code className="truncate rounded px-1.5 py-0.5 font-mono text-xs" style={{ backgroundColor: '#F3F4F6', color: '#374151' }}>
            {loadingScripts ? 'Detecting scripts...' : commandLabel}
          </code>
          {deploy && <Badge variant={statusVariant(deploy.status)}>{statusLabel(deploy.status)}</Badge>}
        </div>
        <button
          type="button"
          aria-label="Run Deploy"
          disabled={!canRun}
          onClick={() => void handleRunDeploy()}
          className="rounded-lg px-3 py-2 text-sm font-medium"
          style={{
            backgroundColor: canRun ? 'var(--card-bg)' : 'var(--card-strong)',
            color: canRun ? 'var(--app-text)' : 'var(--app-text-secondary)',
            border: '0.5px solid var(--app-border)',
          }}
        >
          {starting ? 'Starting...' : '▶ Deploy'}
        </button>
      </div>

      {scripts && scripts.scripts.length === 0 && !loadingScripts && (
        <div className="mt-2 text-sm" style={{ color: 'var(--status-danger)' }}>No deployable package scripts found.</div>
      )}

      {error && (
        <div className="mt-2 rounded-lg px-3 py-2 text-sm" style={{ backgroundColor: 'var(--card-subtle)', border: '0.5px solid var(--app-border)', color: 'var(--status-danger)' }}>
          {error}
        </div>
      )}

      {showTerminal && (
        <pre
          className="mt-2 max-h-[200px] overflow-y-auto whitespace-pre-wrap rounded-md p-3 font-mono text-xs leading-relaxed"
          style={{ backgroundColor: '#1E1E1E', color: '#A3BE8C' }}
        >
          {logText || (
            <span className="flex items-center gap-2">
              <span className="h-3 w-3 animate-spin rounded-full border" style={{ borderColor: '#4B5563', borderTopColor: '#A3BE8C' }} />
              Starting process...
            </span>
          )}
        </pre>
      )}
    </div>
  );
}
