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
      <div className="ml-10 rounded-lg p-4 text-sm" style={{ backgroundColor: '#FFFFFF', border: '0.5px solid var(--app-border)', color: 'var(--app-text-secondary)' }}>
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
      <div className="ml-10 rounded-lg p-4 text-sm" style={{ backgroundColor: '#FFFFFF', border: '0.5px solid var(--app-border)', color: 'var(--app-text-secondary)' }}>
        No file changes detected in this run
      </div>
    );
  }

  return (
    <div className="ml-10 overflow-hidden rounded-lg" style={{ backgroundColor: '#FFFFFF', border: '0.5px solid var(--app-border)' }}>
      <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--app-border)' }}>
        <div className="text-sm font-medium" style={{ color: 'var(--app-text)' }}>
          Code Changes
        </div>
        <div className="text-xs" style={{ color: 'var(--app-text-secondary)' }}>
          Code Review
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
                    <div key={change.filePath} className="overflow-hidden rounded-md" style={{ border: '0.5px solid #D8DEE4', backgroundColor: '#FFFFFF' }}>
                      <button
                        type="button"
                        className="w-full px-4 py-3 flex items-center justify-between gap-4 text-left"
                        onClick={() =>
                          setOpenFiles((cur) => ({ ...cur, [change.filePath]: !expanded }))
                        }
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="text-sm font-medium truncate" style={{ color: '#24292F' }}>
                              {formatRelativePath(change.filePath, workspaceRootPath)}
                            </div>
                            <Badge variant="muted">{getChangeTypeLabel(change.changeType)}</Badge>
                          </div>
                          <div className="mt-1 text-xs flex flex-wrap items-center gap-2" style={{ color: '#57606A' }}>
                            <span style={{ color: '#1A7F37' }}>+{addedCount}</span>
                            <span style={{ color: '#CF222E' }}>-{deletedCount}</span>
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
                        <span className="shrink-0 text-xs" style={{ color: '#57606A' }}>
                          {expanded ? 'Collapse' : 'Expand'}
                        </span>
                      </button>

                      {showLoadPrompt && (
                        <div className="px-4 py-3 text-xs" style={{ borderTop: '0.5px solid #D8DEE4', color: '#57606A', backgroundColor: '#F6F8FA' }}>
                          <div>Large diff, click to load</div>
                          <button
                            type="button"
                            className="mt-3 rounded-md px-3 py-2 text-xs font-medium"
                            style={{ backgroundColor: '#FFFFFF', color: '#24292F', border: '0.5px solid #D8DEE4' }}
                            aria-label={`Load diff for ${formatRelativePath(change.filePath, workspaceRootPath)}`}
                            onClick={() =>
                              setLoadedLargeDiffs((cur) => ({ ...cur, [change.filePath]: true }))
                            }
                          >
                            Load Diff
                          </button>
                        </div>
                      )}

                      {expanded && (!largeDiff || diffLoaded) && <UnifiedDiffView change={change} />}
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

type UnifiedDiffLine = {
  kind: 'context' | 'add' | 'delete';
  oldLine: number | null;
  newLine: number | null;
  text: string;
};

function splitContentLines(content: string) {
  if (!content) return [];
  const lines = content.split('\n');
  return lines.at(-1) === '' ? lines.slice(0, -1) : lines;
}

function buildUnifiedDiffLines(change: FileChange): UnifiedDiffLine[] {
  const oldLines = splitContentLines(change.oldContent);
  const newLines = splitContentLines(change.newContent);

  if (change.changeType === 'create') {
    return newLines.map((text, index) => ({
      kind: 'add',
      oldLine: null,
      newLine: index + 1,
      text,
    }));
  }

  if (change.changeType === 'delete') {
    return oldLines.map((text, index) => ({
      kind: 'delete',
      oldLine: index + 1,
      newLine: null,
      text,
    }));
  }

  const table = Array.from({ length: oldLines.length + 1 }, () =>
    Array.from({ length: newLines.length + 1 }, () => 0),
  );

  for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex -= 1) {
      table[oldIndex][newIndex] = oldLines[oldIndex] === newLines[newIndex]
        ? table[oldIndex + 1][newIndex + 1] + 1
        : Math.max(table[oldIndex + 1][newIndex], table[oldIndex][newIndex + 1]);
    }
  }

  const result: UnifiedDiffLine[] = [];
  let oldIndex = 0;
  let newIndex = 0;
  while (oldIndex < oldLines.length || newIndex < newLines.length) {
    if (oldIndex < oldLines.length && newIndex < newLines.length && oldLines[oldIndex] === newLines[newIndex]) {
      result.push({
        kind: 'context',
        oldLine: oldIndex + 1,
        newLine: newIndex + 1,
        text: oldLines[oldIndex],
      });
      oldIndex += 1;
      newIndex += 1;
      continue;
    }
    if (
      newIndex < newLines.length
      && (oldIndex >= oldLines.length || table[oldIndex][newIndex + 1] > table[oldIndex + 1][newIndex])
    ) {
      result.push({
        kind: 'add',
        oldLine: null,
        newLine: newIndex + 1,
        text: newLines[newIndex],
      });
      newIndex += 1;
      continue;
    }
    if (oldIndex < oldLines.length) {
      result.push({
        kind: 'delete',
        oldLine: oldIndex + 1,
        newLine: null,
        text: oldLines[oldIndex],
      });
      oldIndex += 1;
    }
  }
  return result;
}

export function UnifiedDiffView({ change }: { change: FileChange }) {
  const lines = buildUnifiedDiffLines(change);

  if (lines.length === 0) {
    return (
      <div className="px-4 py-3 text-xs italic" style={{ borderTop: '0.5px solid #D8DEE4', color: '#57606A', backgroundColor: '#F6F8FA' }}>
        No textual diff available
      </div>
    );
  }

  return (
    <div className="overflow-x-auto" style={{ borderTop: '0.5px solid #D8DEE4', backgroundColor: '#FFFFFF' }}>
      {lines.map((line, index) => {
        const sign = line.kind === 'add' ? '+' : line.kind === 'delete' ? '-' : ' ';
        const color = line.kind === 'add'
          ? '#1A7F37'
          : line.kind === 'delete'
            ? '#CF222E'
            : '#57606A';
        const textColor = '#24292F';
        const backgroundColor = line.kind === 'add'
          ? '#E6FFEC'
          : line.kind === 'delete'
            ? '#FFEBE9'
            : '#FFFFFF';

        return (
          <div
            key={`${line.kind}-${index}-${line.text}`}
            className="grid"
            style={{
              gridTemplateColumns: '40px 40px 28px minmax(0, 1fr)',
              backgroundColor,
              borderTop: index === 0 ? undefined : '0.5px solid #D8DEE4',
            }}
          >
            <div className="px-2 py-1 text-right text-xs select-none" style={{ color: '#6E7781', backgroundColor: '#F6F8FA', borderRight: '0.5px solid #D8DEE4' }}>
              {line.oldLine ?? ''}
            </div>
            <div className="px-2 py-1 text-right text-xs select-none" style={{ color: '#6E7781', backgroundColor: '#F6F8FA', borderRight: '0.5px solid #D8DEE4' }}>
              {line.newLine ?? ''}
            </div>
            <div className="px-2 py-1 text-center text-xs select-none font-mono" style={{ color }}>
              {sign}
            </div>
            <pre className="px-2 py-1 text-xs whitespace-pre-wrap break-all font-mono" style={{ color: textColor, margin: 0 }}>
              {`${sign} ${line.text}`}
            </pre>
          </div>
        );
      })}
    </div>
  );
}
