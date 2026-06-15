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
                  const largeDiff = isLargeDiff(change);
                  const diffLoaded = loadedLargeDiffs[change.filePath] ?? false;
                  const showLoadPrompt = largeDiff && expanded && !diffLoaded;

                  return (
                    <FileDiffBlock
                      key={change.filePath}
                      change={change}
                      workspaceRootPath={workspaceRootPath}
                      expanded={expanded}
                      checkLabel={checkLabel}
                      largeDiff={largeDiff}
                      showLoadPrompt={showLoadPrompt}
                      onToggle={() =>
                        setOpenFiles((cur) => ({ ...cur, [change.filePath]: !expanded }))
                      }
                      onLoadLargeDiff={() =>
                        setLoadedLargeDiffs((cur) => ({ ...cur, [change.filePath]: true }))
                      }
                    />
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

export function FileDiffBlock({
  change,
  workspaceRootPath = null,
  expanded = true,
  checkLabel,
  largeDiff = false,
  showLoadPrompt = false,
  onToggle,
  onLoadLargeDiff,
}: {
  change: FileChange;
  workspaceRootPath?: string | null;
  expanded?: boolean;
  checkLabel?: string;
  largeDiff?: boolean;
  showLoadPrompt?: boolean;
  onToggle?: () => void;
  onLoadLargeDiff?: () => void;
}) {
  const addedCount = getLineCount(change.newContent);
  const deletedCount = getLineCount(change.oldContent);
  const relativePath = formatRelativePath(change.filePath, workspaceRootPath);
  const headerContent = (
    <>
      <div className="flex min-w-0 items-center gap-2">
        <code className="truncate text-[13px] font-medium" style={{ color: '#24292F' }}>
          {relativePath}
        </code>
        <Badge variant="muted">{getChangeTypeLabel(change.changeType)}</Badge>
      </div>
      <div className="flex shrink-0 items-center gap-2 text-xs" style={{ color: '#57606A' }}>
        <span style={{ color: '#1A7F37' }}>+{addedCount}</span>
        <span style={{ color: '#CF222E' }}>-{deletedCount}</span>
        {largeDiff && <span>Large diff</span>}
        {checkLabel && (
          <>
            {checkLabel.startsWith('conflict') && <Badge variant="conflict">conflict</Badge>}
            {checkLabel.startsWith('skipped') && <Badge variant="skipped">skipped</Badge>}
            {checkLabel === 'safe' && <Badge variant="applied">safe</Badge>}
            <span>{checkLabel}</span>
          </>
        )}
        {onToggle && <span>{expanded ? 'Collapse' : 'Expand'}</span>}
      </div>
    </>
  );
  const headerStyle = {
    backgroundColor: '#F6F8FA',
    borderBottom: expanded ? '0.5px solid var(--app-border)' : undefined,
  };

  return (
    <div
      className="mb-6 overflow-hidden rounded-lg"
      style={{
        border: '0.5px solid var(--app-border)',
        backgroundColor: '#FFFFFF',
      }}
    >
      {onToggle ? (
        <button
          type="button"
          className="flex w-full items-center justify-between gap-4 px-4 py-2 text-left"
          style={headerStyle}
          onClick={onToggle}
        >
          {headerContent}
        </button>
      ) : (
        <div className="flex w-full items-center justify-between gap-4 px-4 py-2" style={headerStyle}>
          {headerContent}
        </div>
      )}

      {showLoadPrompt && (
        <div className="px-4 py-3 text-xs" style={{ color: '#57606A', backgroundColor: '#F6F8FA' }}>
          <div>Large diff, click to load</div>
          <button
            type="button"
            className="mt-3 rounded-md px-3 py-2 text-xs font-medium"
            style={{ backgroundColor: '#FFFFFF', color: '#24292F', border: '0.5px solid #D0D7DE' }}
            aria-label={`Load diff for ${relativePath}`}
            onClick={onLoadLargeDiff}
          >
            Load Diff
          </button>
        </div>
      )}

      {expanded && !showLoadPrompt && <UnifiedDiffView change={change} />}
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
    <div
      className="diff-scrollbar overflow-x-auto"
      style={{ backgroundColor: '#FFFFFF' }}
    >
      {lines.map((line, index) => {
        const sign = line.kind === 'add' ? '+' : line.kind === 'delete' ? '-' : ' ';
        const displayLine = line.kind === 'delete' ? line.oldLine : line.newLine;
        const backgroundColor = line.kind === 'add'
          ? '#e6ffec'
          : line.kind === 'delete'
            ? '#ffebe9'
            : '#FFFFFF';
        const dividerColor = line.kind === 'add'
          ? '#B7E4C7'
          : line.kind === 'delete'
            ? '#FFD7D5'
            : '#D0D7DE';

        return (
          <div
            key={`${line.kind}-${index}-${line.text}`}
            className="diff-row flex w-full"
            style={{
              display: 'flex',
              width: '100%',
              minWidth: 'max-content',
              fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
              fontSize: 12,
              lineHeight: '20px',
              backgroundColor,
            }}
          >
            <div
              className="diff-line-number shrink-0 text-right"
              style={{
                minWidth: 48,
                paddingRight: 12,
                color: '#6E7781',
                borderRight: `0.5px solid ${dividerColor}`,
                userSelect: 'none',
              }}
            >
              {displayLine ?? ''}
            </div>
            <pre
              className="diff-code-cell flex-1"
              style={{
                margin: 0,
                paddingLeft: 16,
                paddingRight: 16,
                color: '#24292F',
                whiteSpace: 'pre',
                wordBreak: 'break-all',
                fontFamily: 'inherit',
              }}
            >
              {`${sign} ${line.text}`}
            </pre>
          </div>
        );
      })}
    </div>
  );
}
