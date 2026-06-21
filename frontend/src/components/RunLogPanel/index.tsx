import { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '../../services/api';
import { applyRunDetail } from '../../store/timeline';
import { normalizeMarkdownTables } from '../../utils/markdown';
import type { ChatTimelineItem, TimelineBlock } from '../../types';

export function RunLogPanel({
  item,
  onInterrupt,
  isActive = false,
}: {
  item: ChatTimelineItem | null;
  onInterrupt: (runId: string) => void;
  isActive?: boolean;
}) {
  const [loadState, setLoadState] = useState<{
    runId: string;
    status: 'loading' | 'loaded' | 'error';
    detail: ChatTimelineItem | null;
    error: string | null;
  } | null>(null);
  const selectedRunIdRef = useRef(item?.runId ?? null);

  const loadDetail = useCallback(async () => {
    if (!item) return;
    const runId = item.runId;
    setLoadState({ runId, status: 'loading', detail: null, error: null });
    try {
      const run = await api.getRun(runId);
      if (selectedRunIdRef.current !== runId) return;
      setLoadState({
        runId,
        status: 'loaded',
        detail: { ...applyRunDetail(run), agentName: item.agentName },
        error: null,
      });
    } catch (nextError: unknown) {
      if (selectedRunIdRef.current !== runId) return;
      setLoadState({
        runId,
        status: 'error',
        detail: null,
        error: nextError instanceof Error ? nextError.message : '加载执行日志失败',
      });
    }
  }, [item]);

  useEffect(() => {
    selectedRunIdRef.current = item?.runId ?? null;
    if (!item || item.detailsLoaded) return;
    const runId = item.runId;
    let cancelled = false;
    api.getRun(runId)
      .then((run) => {
        if (cancelled) return;
        setLoadState({
          runId,
          status: 'loaded',
          detail: { ...applyRunDetail(run), agentName: item.agentName },
          error: null,
        });
      })
      .catch((nextError: unknown) => {
        if (cancelled) return;
        setLoadState({
          runId,
          status: 'error',
          detail: null,
          error: nextError instanceof Error ? nextError.message : '加载执行日志失败',
        });
      });
    return () => { cancelled = true; };
  }, [item]);

  if (!item) {
    return <div className="text-sm text-[var(--app-text-secondary)]">选择一个 Run 查看执行日志</div>;
  }

  const selected = loadState?.runId === item.runId && loadState.detail ? loadState.detail : item;
  const loading = !item.detailsLoaded && (loadState?.runId !== item.runId || loadState.status === 'loading');
  const error = loadState?.runId === item.runId ? loadState.error : null;
  const canInterrupt = isActive || selected.status === 'queued' || selected.status === 'running';

  return (
    <section aria-label="执行日志" className="space-y-4">
      <header className="space-y-3 border-b border-[var(--app-border)] pb-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-[var(--app-text)]">
              {selected.agentName ?? 'Agent'}
            </div>
            <div className="mt-0.5 text-xs text-[var(--app-text-secondary)]">{selected.status}</div>
          </div>
          {canInterrupt && (
            <button
              type="button"
              onClick={() => onInterrupt(selected.runId)}
              className="text-xs font-medium text-[var(--status-warning)] hover:underline"
            >
              中断执行
            </button>
          )}
        </div>
        <div className="rounded-md bg-[var(--card-subtle)] px-3 py-2 text-xs leading-relaxed text-[var(--app-text-secondary)]">
          {selected.prompt}
        </div>
      </header>

      {loading && <div className="text-sm text-[var(--app-text-secondary)]">Loading execution log...</div>}

      {error && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-[var(--status-danger)]">
          <div>{error}</div>
          <button type="button" onClick={() => void loadDetail()} className="mt-2 font-medium hover:underline">
            重新加载日志
          </button>
        </div>
      )}

      {!loading && !error && <RunLogBlocks blocks={selected.blocks} />}

      {selected.error && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-[var(--status-danger)]">
          {selected.error}
        </div>
      )}
    </section>
  );
}

function RunLogBlocks({ blocks }: { blocks: TimelineBlock[] }) {
  if (blocks.length === 0) {
    return <div className="text-sm text-[var(--app-text-secondary)]">暂无执行记录</div>;
  }

  return (
    <div className="space-y-3">
      {blocks.map((block) => {
        if (block.kind === 'agent_text') {
          return (
            <div key={block.id} className="markdown-body text-sm">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {normalizeMarkdownTables(block.content)}
              </ReactMarkdown>
            </div>
          );
        }

        if (block.kind === 'tool_call') {
          return (
            <article key={block.id} className="rounded-md bg-[var(--card-subtle)] p-3">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="font-medium text-[var(--app-text)]">{block.toolName}</span>
                <span className="text-[var(--app-text-secondary)]">{block.status}</span>
              </div>
              <div className="mt-2 break-all font-mono text-xs text-[var(--app-text-secondary)]">
                {block.inputPreview}
              </div>
              {block.resultContent && (
                <pre
                  className={[
                    'mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-md p-3 font-mono text-xs leading-relaxed',
                    block.resultKind === 'bash'
                      ? 'bg-[#1A1A1A] text-[#D1D5DB]'
                      : 'bg-white text-[var(--app-text-secondary)]',
                  ].join(' ')}
                >
                  {block.resultContent}
                </pre>
              )}
            </article>
          );
        }

        if (block.kind === 'approval_request') {
          return (
            <div key={block.id} className="rounded-md bg-amber-50 p-3 text-xs text-[var(--status-warning)]">
              {block.reason}
            </div>
          );
        }

        return (
          <div key={block.id} className="text-xs text-[var(--app-text-secondary)]">
            {block.changeType}: {block.filePath}
          </div>
        );
      })}
    </div>
  );
}
