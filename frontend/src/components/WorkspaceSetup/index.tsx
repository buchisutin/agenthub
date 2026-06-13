import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../../store/useApp';
import { api } from '../../services/api';
import { loadConversationRuntime } from '../../store/runtimeActions';
import { socketService } from '../../services/socket';
import { Badge } from '../ui/Badge';
import type { BadgeVariant } from '../ui/Badge';
import type { WorkspaceValidationResult } from '../../types';

interface WorkspaceSetupProps {
  compact?: boolean;
  onCreated?: (convId: string) => void;
}

const DEBOUNCE_MS = 800;
const PLACEHOLDER = '/Users/me/myproject';

export function WorkspaceSetup({ compact, onCreated }: WorkspaceSetupProps) {
  const { dispatch } = useApp();
  const [rootPath, setRootPath] = useState('');
  const [validating, setValidating] = useState(false);
  const [creating, setCreating] = useState(false);
  const [validation, setValidation] = useState<WorkspaceValidationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runtimeAvailable, setRuntimeAvailable] = useState<boolean | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Check runtime once on mount (for the badge).
  useEffect(() => {
    api.checkRuntime('claude_cli')
      .then((c) => setRuntimeAvailable(c.available))
      .catch(() => setRuntimeAvailable(false));
  }, []);

  const triggerValidate = useCallback((path: string) => {
    if (!path.trim()) {
      setValidation(null);
      setError(null);
      return;
    }
    setValidating(true);
    setError(null);
    api.validateWorkspace(path.trim())
      .then((result) => setValidation(result))
      .catch((e) => setError(e instanceof Error ? e.message : '验证失败'))
      .finally(() => setValidating(false));
  }, []);

  function handleChange(value: string) {
    setRootPath(value);
    setValidation(null);
    setError(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => triggerValidate(value), DEBOUNCE_MS);
  }

  async function handleCreate() {
    if (!rootPath.trim() || creating || !validation || validation.errors.length > 0) return;
    setCreating(true);
    setError(null);
    try {
      const result = await api.createConversationWithWorkspace({
        title: pathBasename(rootPath.trim()),
        rootPath: rootPath.trim(),
      });
      dispatch({ type: 'ADD_CONVERSATION', payload: result.conversation });
      dispatch({ type: 'SET_WORKSPACE', payload: { convId: result.conversation.id, workspace: result.workspace } });
      dispatch({ type: 'SELECT_CONVERSATION', payload: result.conversation.id });
      socketService.joinConversation(result.conversation.id);
      try {
        const tl = await loadConversationRuntime(result.conversation.id, dispatch);
        for (const item of tl.items) socketService.subscribeRun(item.runId);
      } catch { /* non-critical */ }
      onCreated?.(result.conversation.id);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '创建协作会话失败');
    } finally {
      setCreating(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key !== 'Enter' || !canCreate || creating) return;
    e.preventDefault();
    void handleCreate();
  }

  const valid = Boolean(validation && validation.errors.length === 0);
  const invalid = Boolean(validation && validation.errors.length > 0);
  const canCreate = Boolean(validation?.exists && validation?.isDirectory && validation?.errors.length === 0 && !error);
  const badges = validation ? buildBadges(validation, runtimeAvailable) : [];

  const card = (
    <div className="agenthub-card w-full max-w-[460px] p-8">
      <div className="space-y-5">
        <h2 className="text-xl font-semibold tracking-[-0.02em]" style={{ color: 'var(--app-text)' }}>
          开始协作
        </h2>

        <div className="space-y-3">
          <div className="relative">
            <input
              value={rootPath}
              onChange={(e) => handleChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={PLACEHOLDER}
              className="w-full rounded-lg px-4 py-3 text-sm font-mono outline-none"
              style={getInputStyle(valid, invalid)}
              autoFocus={!compact}
              spellCheck={false}
            />
            {validating && (
              <span className="absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border-2 animate-spin"
                style={{ borderColor: 'var(--color-accent)', borderTopColor: 'transparent' }}
              />
            )}
          </div>

          <p className="text-xs" style={{ color: 'var(--app-text-secondary)' }}>
            Web 版本需手动粘贴绝对路径
          </p>

          {valid && (
            <div className="flex flex-wrap items-center gap-2">
              {badges.map((b) => (
                <Badge key={b.label} variant={b.variant}>{b.label}</Badge>
              ))}
            </div>
          )}

          {invalid && validation && (
            <div className="space-y-1">
              {validation.errors.map((err) => (
                <div key={err} className="text-sm" style={{ color: 'var(--status-danger)' }}>{err}</div>
              ))}
            </div>
          )}

          {error && (
            <div className="text-sm" style={{ color: 'var(--status-danger)' }}>{error}</div>
          )}
        </div>

        <button
          type="button"
          disabled={!canCreate || creating}
          onClick={() => void handleCreate()}
          className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-medium transition-colors"
          aria-label={creating ? '创建中...' : '创建协作会话'}
          style={{
            backgroundColor: canCreate ? '#1A6BCC' : 'var(--card-strong)',
            color: canCreate ? '#FFFFFF' : 'var(--app-text-secondary)',
            border: canCreate ? '0.5px solid #1A6BCC' : '0.5px solid var(--app-border)',
            boxShadow: canCreate ? '0 4px 12px rgba(26, 107, 204, 0.16)' : 'none',
            opacity: creating ? 0.8 : 1,
            cursor: !canCreate || creating ? 'not-allowed' : 'pointer',
          }}
        >
          <span
            style={{
              color: canCreate ? '#FFFFFF' : 'var(--app-text-secondary)',
              fontWeight: 600,
              lineHeight: 1,
            }}
          >
            {creating ? '创建中...' : '创建协作会话 →'}
          </span>
        </button>
      </div>
    </div>
  );

  if (compact) return card;

  return (
    <div className="flex flex-1 items-center justify-center overflow-y-auto px-6 py-12" style={{ backgroundColor: 'var(--app-bg)' }}>
      {card}
    </div>
  );
}

function buildBadges(validation: WorkspaceValidationResult, runtimeAvailable: boolean | null) {
  const badges: Array<{ label: string; variant: BadgeVariant }> = [];
  if (validation.isGitRepo) badges.push({ label: '✓ git', variant: 'completed' });
  else badges.push({ label: '✗ git', variant: 'muted' });
  if (validation.previewCapable) badges.push({ label: '✓ 预览', variant: 'completed' });
  else badges.push({ label: '✗ 预览', variant: 'best_effort' });
  const rtLabel = runtimeAvailable === false ? '⚠ runtime' : runtimeAvailable === true ? '✓ runtime' : '… runtime';
  const rtVariant: BadgeVariant = runtimeAvailable === false ? 'best_effort' : runtimeAvailable === true ? 'completed' : 'muted';
  badges.push({ label: rtLabel, variant: rtVariant });
  return badges;
}

function getInputStyle(valid: boolean, invalid: boolean) {
  const borderColor = valid
    ? '#1A7F4B'
    : invalid
      ? 'var(--status-danger)'
      : 'var(--app-border)';
  return {
    backgroundColor: 'var(--card-bg)',
    color: 'var(--app-text)',
    border: `1px solid ${borderColor}`,
    borderRadius: '8px',
  };
}

function pathBasename(p: string): string {
  const parts = p.replace(/\/+$/, '').split('/');
  return parts[parts.length - 1] || 'project';
}
