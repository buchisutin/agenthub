import { useEffect, useMemo, useState } from 'react';
import { api } from '../../services/api';
import { Badge } from '../ui/Badge';
import type { ApplyCheckResult, FileChange } from '../../types';
import { formatRelativePath } from '../../utils/pathDisplay';

const LARGE_DIFF_LINE_THRESHOLD = 500;
const AUTO_EXPAND_FILE_COUNT = 3;

type DiffGroupKey = 'create' | 'edit' | 'delete';

export function DiffCard({
  runId,
  applyCheck,
  workspaceRootPath = null,
}: {
  runId: string;
  applyCheck?: ApplyCheckResult | null;
  workspaceRootPath?: string | null;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [changes, setChanges] = useState<FileChange[]>([]);
  const [openFiles, setOpenFiles] = useState<Record<string, boolean>>({});
  const [loadedLargeDiffs, setLoadedLargeDiffs] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const nextChanges = await api.getRunFileChanges(runId);
        if (cancelled) return;
        setChanges(nextChanges);
        const shouldAutoExpand = nextChanges.length <= AUTO_EXPAND_FILE_COUNT;
        setOpenFiles(
          nextChanges.reduce<Record<string, boolean>>((acc, change) => {
            acc[change.filePath] = shouldAutoExpand;
            return acc;
          }, {}),
        );
        setLoadedLargeDiffs({});
      } catch (e: unknown) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load file changes');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [runId]);

  const hasBestEffort = useMemo(
    () => changes.some((c) => c.confidence === 'best_effort'),
    [changes],
  );

  const checkFileMap = useMemo(() => {
    if (!applyCheck?.files) return new Map<string, string>();
    const map = new Map<string, string>();
    for (const f of applyCheck.files) {
      const label = f.status === 'conflict' ? `conflict: ${f.reason ?? ''}`
        : f.status === 'skipped' ? `skipped: ${f.reason ?? ''}`
        : f.status === 'safe' ? 'safe' : '';
      if (label) map.set(f.filePath, label);
    }
    return map;
  }, [applyCheck]);

  const groupedChanges = useMemo(() => groupChangesByType(changes), [changes]);

  if (loading) {
    return (
      <div className="agenthub-card ml-10 p-4 text-sm" style={{ color: 'var(--app-text-secondary)' }}>
        Loading file changes...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl ml-10 p-4 text-sm" style={{ backgroundColor: 'rgba(220, 38, 38, 0.08)', border: '1px solid rgba(220, 38, 38, 0.18)', color: 'var(--status-danger)' }}>
        {error}
      </div>
    );
  }

  if (changes.length === 0) {
    return (
      <div className="agenthub-card ml-10 p-4 text-sm" style={{ color: 'var(--app-text-secondary)' }}>
        No file changes detected in this run
      </div>
    );
  }

  return (
    <div className="agenthub-card ml-10 overflow-hidden">
      <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--app-border)' }}>
        <div className="text-sm font-medium" style={{ color: 'var(--app-text)' }}>
          Code Changes
        </div>
        <div className="text-xs" style={{ color: 'var(--app-text-secondary)' }}>
          Split Diff
        </div>
      </div>

      {hasBestEffort && (
        <div className="mx-4 mt-4 rounded-lg px-3 py-2 text-xs" style={{ backgroundColor: 'rgba(217, 119, 6, 0.08)', color: 'var(--status-warning)', border: '1px solid rgba(217, 119, 6, 0.18)' }}>
          This diff is inferred from available events and may be incomplete
        </div>
      )}

      <div className="p-4 space-y-4">
        {(['create', 'edit', 'delete'] as const).map((groupKey) => {
          const groupChanges = groupedChanges[groupKey];
          if (groupChanges.length === 0) {
            return null;
          }

          return (
            <section key={groupKey} className="space-y-3">
              <div className="px-1 text-xs font-semibold uppercase tracking-wide" style={{ color: '#8B949E' }}>
                {getChangeTypeLabel(groupKey)} ({groupChanges.length})
              </div>

              <div className="space-y-3">
                {groupChanges.map((change) => {
                  const expanded = openFiles[change.filePath] ?? false;
                  const checkLabel = checkFileMap.get(change.filePath);
                  const addedCount = getLineCount(change.newContent);
                  const deletedCount = getLineCount(change.oldContent);
                  const largeDiff = isLargeDiff(change);
                  const diffLoaded = loadedLargeDiffs[change.filePath] ?? false;
                  const showLoadPrompt = largeDiff && expanded && !diffLoaded;

                  return (
                    <div key={change.filePath} className="rounded-lg overflow-hidden" style={{ border: '1px solid #30363D', backgroundColor: '#0D1117' }}>
                      <button
                        type="button"
                        className="w-full px-4 py-3 flex items-center justify-between gap-4 text-left"
                        onClick={() =>
                          setOpenFiles((cur) => ({ ...cur, [change.filePath]: !expanded }))
                        }
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="text-sm font-medium truncate" style={{ color: '#C9D1D9' }}>
                              {formatRelativePath(change.filePath, workspaceRootPath)}
                            </div>
                            <Badge variant="muted">{getChangeTypeLabel(change.changeType)}</Badge>
                          </div>
                          <div className="mt-1 text-xs flex flex-wrap items-center gap-2" style={{ color: '#8B949E' }}>
                            <span style={{ color: '#15803D' }}>+{addedCount}</span>
                            <span style={{ color: '#991B1B' }}>-{deletedCount}</span>
                            {largeDiff && (
                              <span>Large diff</span>
                            )}
                            {checkLabel && (
                              <>
                                {checkLabel.startsWith('conflict') && <Badge variant="conflict">conflict</Badge>}
                                {checkLabel.startsWith('skipped') && <Badge variant="skipped">skipped</Badge>}
                                {checkLabel === 'safe' && <Badge variant="applied">safe</Badge>}
                                <span>{checkLabel}</span>
                              </>
                            )}
                          </div>
                        </div>
                        <span className="shrink-0 text-xs" style={{ color: '#8B949E' }}>
                          {expanded ? 'Collapse' : 'Expand'}
                        </span>
                      </button>

                      {showLoadPrompt && (
                        <div className="px-4 py-3 text-xs" style={{ borderTop: '1px solid #30363D', color: '#8B949E', backgroundColor: '#0D1117' }}>
                          <div>Large diff, click to load</div>
                          <button
                            type="button"
                            className="mt-3 rounded-md px-3 py-2 text-xs font-medium"
                            style={{ backgroundColor: '#161B22', color: '#C9D1D9', border: '1px solid #30363D' }}
                            aria-label={`Load diff for ${formatRelativePath(change.filePath, workspaceRootPath)}`}
                            onClick={() =>
                              setLoadedLargeDiffs((cur) => ({ ...cur, [change.filePath]: true }))
                            }
                          >
                            Load Diff
                          </button>
                        </div>
                      )}

                      {expanded && (!largeDiff || diffLoaded) && <SplitDiff change={change} />}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function getLineCount(content: string) {
  return content.split('\n').filter((line) => line.length > 0).length;
}

function isLargeDiff(change: FileChange) {
  return Math.max(getLineCount(change.oldContent), getLineCount(change.newContent)) > LARGE_DIFF_LINE_THRESHOLD;
}

function groupChangesByType(changes: FileChange[]) {
  return changes.reduce<Record<DiffGroupKey, FileChange[]>>((acc, change) => {
    const groupKey = change.changeType === 'create'
      ? 'create'
      : change.changeType === 'delete'
        ? 'delete'
        : 'edit';
    acc[groupKey].push(change);
    return acc;
  }, {
    create: [],
    edit: [],
    delete: [],
  });
}

function getChangeTypeLabel(changeType: FileChange['changeType'] | DiffGroupKey) {
  switch (changeType) {
    case 'create':
      return 'Added';
    case 'delete':
      return 'Deleted';
    default:
      return 'Modified';
  }
}

function SplitDiff({ change }: { change: FileChange }) {
  const leftLines = change.oldContent.split('\n');
  const rightLines = change.newContent.split('\n');
  const rows = Math.max(leftLines.length, rightLines.length);

  return (
    <div className="grid grid-cols-2" style={{ borderTop: '1px solid #30363D' }}>
      <DiffPane
        title="Before"
        lines={leftLines}
        totalRows={rows}
        emptyLabel={change.changeType === 'create' ? 'New file, no old content' : 'No old content'}
      />
      <DiffPane
        title="After"
        lines={rightLines}
        totalRows={rows}
        emptyLabel={change.changeType === 'delete' ? 'File deleted' : 'No new content'}
        right
      />
    </div>
  );
}

function DiffPane({
  title,
  lines,
  totalRows,
  emptyLabel,
  right = false,
}: {
  title: string;
  lines: string[];
  totalRows: number;
  emptyLabel: string;
  right?: boolean;
}) {
  const isEmpty = lines.length === 1 && lines[0] === '';

  return (
    <div style={{ borderLeft: right ? '1px solid #30363D' : undefined }}>
      <div className="px-4 py-2 text-xs font-medium" style={{ color: '#8B949E', backgroundColor: '#161B22' }}>
        {title}
      </div>
      {isEmpty ? (
        <div className="px-4 py-3 text-xs italic" style={{ color: '#6E7681' }}>
          {emptyLabel}
        </div>
      ) : (
        <div className="overflow-x-auto">
          {Array.from({ length: totalRows }).map((_, index) => {
            const line = lines[index] ?? '';
            const backgroundColor = right
              ? line ? 'rgba(46, 160, 67, 0.10)' : 'transparent'
              : line ? 'rgba(248, 81, 73, 0.08)' : 'transparent';

            return (
              <div
                key={`${title}-${index}`}
                className="grid"
                style={{
                  gridTemplateColumns: '48px 1fr',
                  backgroundColor,
                  borderTop: index === 0 ? undefined : '1px solid rgba(48, 54, 61, 0.35)',
                }}
              >
                <div className="px-3 py-1 text-right text-xs select-none" style={{ color: '#6E7681', borderRight: '1px solid rgba(48, 54, 61, 0.35)' }}>
                  {line || index < lines.length ? index + 1 : ''}
                </div>
                <pre className="px-3 py-1 text-xs whitespace-pre-wrap break-all font-mono" style={{ color: '#C9D1D9', margin: 0 }}>
                  {line}
                </pre>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
