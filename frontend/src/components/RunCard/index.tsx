import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '../../services/api';
import { applyRunDetail } from '../../store/timeline';
import { useApp } from '../../store/useApp';
import { Badge } from '../ui/Badge';
import { getStatusLabel, getStatusVariant } from '../ui/status';
import { normalizeMarkdownTables } from '../../utils/markdown';
import { formatRelativePath } from '../../utils/pathDisplay';
import type {
  ChatTimelineItem,
  FileChange,
  RunChangeApplication,
  RunWorkspace,
  TimelineBlock,
  ToolCallBlock,
} from '../../types';

function looksLikeMachineId(value: string) {
  const trimmed = value.trim();
  const hyphenCount = (trimmed.match(/-/g) ?? []).length;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed)
    || (hyphenCount >= 2 && /^[a-z0-9-]{16,}$/i.test(trimmed))
    || (trimmed.length > 20 && /^[a-z0-9-]+$/i.test(trimmed));
}

function getSafeAgentTitle(agentName: string | null | undefined, agentId: string | null | undefined) {
  const candidate = agentName?.trim() || agentId?.trim() || '';
  const fallback = /orchestrator/i.test(`${agentName ?? ''} ${agentId ?? ''}`) ? 'Orchestrator' : 'Agent';
  if (!candidate || looksLikeMachineId(candidate)) return fallback;
  return candidate;
}

export function RunCard({
  item,
  isActive,
  onInterrupt,
  onFocusArtifacts,
}: {
  item: ChatTimelineItem;
  isActive: boolean;
  onInterrupt: () => void;
  onFocusArtifacts?: (runId: string, tab: 'diff' | 'preview') => void;
}) {
  const { dispatch } = useApp();
  const cardRef = useRef<HTMLDivElement | null>(null);
  const running = item.status === 'queued' || item.status === 'running';
  const [isVisible, setIsVisible] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [runWorkspace, setRunWorkspace] = useState<RunWorkspace | null>(null);
  const [changeApp, setChangeApp] = useState<RunChangeApplication | null>(null);
  const [fileChanges, setFileChanges] = useState<FileChange[]>([]);
  const [mergeMode, setMergeMode] = useState<'auto' | 'manual'>('manual');
  const [mergeStatus, setMergeStatus] = useState<'pending' | 'auto_merged' | 'conflict_resolved' | 'needs_approval' | 'failed' | null>(null);
  const [detailsExpanded, setDetailsExpanded] = useState(item.status === 'failed' || item.status === 'interrupted' || Boolean(item.error));

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') {
      setIsVisible(true);
      return;
    }
    const node = cardRef.current;
    if (!node) {
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setIsVisible(true);
        }
      },
      { rootMargin: '240px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const shouldLoadRunMeta = running || isActive || isVisible;

  useEffect(() => {
    if (!shouldLoadRunMeta) {
      return;
    }
    let cancelled = false;
    api.getRunCardSummary(item.runId).then((summary) => {
      if (cancelled) return;
      setRunWorkspace(summary.workspace);
      setChangeApp(summary.changeApplication);
      setFileChanges(summary.fileChanges);
      setMergeMode(summary.mergeMode ?? 'manual');
      setMergeStatus(summary.mergeStatus ?? null);
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [item.conversationId, item.runId, item.status, shouldLoadRunMeta]);

  useEffect(() => {
    if (running) {
      setDetailsExpanded(true);
      return;
    }
    if (item.status === 'failed' || item.status === 'interrupted' || item.error) {
      setDetailsExpanded(true);
      return;
    }
    setDetailsExpanded(false);
  }, [item.error, item.runId, item.status]);

  const toolBlocks = item.blocks.filter((block): block is ToolCallBlock => block.kind === 'tool_call');
  const eventCount = item.eventCount ?? 0;
  const canLoadDetail = !item.detailsLoaded && eventCount > 0;
  const isCleaned = runWorkspace?.status === 'cleaned';
  const isApplied = changeApp?.status === 'applied';
  const canShowActions = item.status === 'completed';
  const hasFileChanges = fileChanges.length > 0;
  const isAutoMergeRun = mergeMode === 'auto';
  const showNoChangesState = canShowActions && !hasFileChanges && !isApplied && !isCleaned && !isAutoMergeRun;
  const hasPendingProjectChanges = canShowActions && hasFileChanges && !isApplied && !isCleaned && !isAutoMergeRun;
  const showAutoMergeState = canShowActions && isAutoMergeRun && !isCleaned;
  const appliedFilesCount = changeApp?.appliedFiles.length ?? fileChanges.length;
  const canCollapse = item.status === 'completed' || running;
  const showCollapsedSummary = canCollapse && !detailsExpanded && !running;

  async function handleLoadDetail() {
    if (loadingDetail || item.detailsLoaded) return;
    setLoadingDetail(true);
    setDetailError(null);
    try {
      const run = await api.getRun(item.runId);
      dispatch({
        type: 'UPSERT_TIMELINE_ITEM',
        payload: {
          convId: item.conversationId,
          item: {
            ...applyRunDetail(run),
            agentName: item.agentName,
          },
        },
      });
    } catch (e: unknown) {
      setDetailError(e instanceof Error ? e.message : '加载执行详情失败');
    } finally {
      setLoadingDetail(false);
    }
  }

  useEffect(() => {
    if (!detailsExpanded || !canLoadDetail || detailError) return;
    void handleLoadDetail();
  }, [canLoadDetail, detailError, detailsExpanded, item.runId]);

  const visibleBlocks = item.blocks.filter((block) => block.kind !== 'tool_call' && block.kind !== 'file_change_indicator');
  const agentTextBlocks = visibleBlocks.filter((block) => block.kind === 'agent_text');
  const auxiliaryBlocks = visibleBlocks.filter((block) => block.kind !== 'agent_text');
  const showAppliedState = Boolean(isApplied && changeApp);
  const showSkippedState = changeApp?.status === 'skipped';
  const showRightPanelGuide = canShowActions && !isCleaned && onFocusArtifacts;
  const showFooter =
    isCleaned
    || hasPendingProjectChanges
    || showAutoMergeState
    || showNoChangesState
    || showAppliedState
    || showSkippedState
    || showRightPanelGuide;

  return (
    <div
      ref={cardRef}
      id={`run-card-${item.runId}`}
      className="mr-auto max-w-[85%] space-y-3 rounded-xl p-4"
      style={{
        backgroundColor: '#FFFFFF',
        border: '0.5px solid #E5E7EB',
        boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
      }}
    >
      <RunHeader
        item={item}
        isActive={isActive}
        onInterrupt={onInterrupt}
        detailsExpanded={detailsExpanded}
        canCollapse={canCollapse}
        onToggleDetails={() => setDetailsExpanded((current) => !current)}
      />

      {showCollapsedSummary ? null : (
        <>

          <div className="space-y-3">
            {toolBlocks.length > 0 ? (
              <RunTimeline blocks={toolBlocks} workspaceRootPath={runWorkspace?.rootPath ?? null} onFocusArtifacts={onFocusArtifacts ? () => onFocusArtifacts(item.runId, 'diff') : undefined} />
            ) : canLoadDetail && loadingDetail ? (
              <div
                className="rounded-lg px-3 py-2 text-sm"
                style={{ backgroundColor: 'var(--card-subtle)', color: 'var(--app-text-secondary)' }}
              >
                正在加载 {eventCount} 条执行记录...
              </div>
            ) : canLoadDetail && detailError ? (
              <button
                type="button"
                onClick={() => void handleLoadDetail()}
                className="rounded-lg px-3 py-2 text-sm font-medium"
                style={secondaryButton(false)}
              >
                重新加载执行记录
              </button>
            ) : null}
            <AgentTextPanel blocks={agentTextBlocks} status={item.status} />
            {auxiliaryBlocks.map((block) => (
              <TimelineBlockView key={block.id} block={block} />
            ))}
          </div>

          {showFooter && (
            <RunFooter>
              {isCleaned && (
                <div className="rounded-lg px-3 py-2 text-sm" style={{ backgroundColor: 'var(--card-subtle)', color: 'var(--app-text-secondary)', border: '0.5px solid var(--app-border)' }}>
                  临时工作区已清理，Diff 和 Preview 已收起
                </div>
              )}
              {hasPendingProjectChanges && (
                <div className="rounded-lg px-3 py-2 text-sm" style={{ backgroundColor: '#FFFBEB', color: '#92400E', border: '0.5px solid #FDE68A' }}>
                  这些改动还停留在隔离工作区里。应用到项目后，后续 Run 才会基于这次结果继续协作。
                </div>
              )}
              {showAutoMergeState && (
                <AutoMergeState
                  mergeStatus={mergeStatus}
                  appliedFilesCount={appliedFilesCount}
                />
              )}
              {showNoChangesState && (
                <div className="flex items-center gap-2">
                  <Badge variant="muted">无文件改动</Badge>
                  <span className="text-xs" style={{ color: 'var(--app-text-secondary)' }}>
                    这次 Run 没有产出可应用到项目目录的文件变化。
                  </span>
                </div>
              )}
              {showAppliedState && changeApp && (
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="applied">已应用</Badge>
                  <span className="hidden">Applied</span>
                  <span className="text-xs" style={{ color: 'var(--app-text-secondary)' }}>
                    改动已经同步到项目目录。
                  </span>
                  <span className="text-xs" style={{ color: 'var(--app-text-secondary)' }}>
                    {changeApp.appliedFiles.length} files
                  </span>
                  {changeApp.skippedFiles.length > 0 && (
                    <span className="text-xs" style={{ color: 'var(--app-text-secondary)' }}>
                      {changeApp.skippedFiles.length} skipped
                    </span>
                  )}
                </div>
              )}
              {showSkippedState && (
                <div className="flex items-center gap-2">
                  <Badge variant="muted">无可应用改动</Badge>
                  <span className="hidden">No changes</span>
                </div>
              )}
              {showRightPanelGuide && (
                <div className="text-sm" style={{ color: '#6B7280' }}>
                  代码已生成。{' '}
                  <button
                    type="button"
                    onClick={() => onFocusArtifacts(item.runId, 'diff')}
                    className="font-medium hover:underline"
                    style={{ color: '#2563EB' }}
                  >
                    在右侧审查并部署
                  </button>
                </div>
              )}
            </RunFooter>
          )}
          {detailError && <InlineError message={detailError} />}
          {item.error && <InlineError message={item.error} />}
        </>
      )}
    </div>
  );
}

function RunHeader({
  item,
  isActive,
  onInterrupt,
  detailsExpanded,
  canCollapse,
  onToggleDetails,
}: {
  item: ChatTimelineItem;
  isActive: boolean;
  onInterrupt: () => void;
  detailsExpanded: boolean;
  canCollapse: boolean;
  onToggleDetails: () => void;
}) {
  const timestamp = useMemo(() => {
    return new Date(item.startedAt).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  }, [item.startedAt]);
  const agentTitle = getSafeAgentTitle(item.agentName, item.agentId);

  return (
    <div className="flex items-center gap-3">
      <div
        className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-xs font-semibold"
        style={{ backgroundColor: 'var(--card-strong)', color: 'var(--app-text)' }}
      >
        {agentTitle.slice(0, 1).toUpperCase()}
      </div>
      <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="text-sm font-semibold" style={{ color: 'var(--app-text)' }}>
              {agentTitle}
            </span>
            <span className="text-xs" style={{ color: '#9CA3AF' }}>
              {timestamp}
            </span>
            <Badge variant={getStatusVariant(item.status)}>{getStatusLabel(item.status)}</Badge>
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          {canCollapse && (
            <button
              type="button"
              onClick={onToggleDetails}
              className="rounded-md px-2.5 py-1 text-xs font-medium"
              style={secondaryButton(false)}
            >
              {detailsExpanded ? '收起' : '展开'}
            </button>
          )}
          {isActive && (
            <button
              type="button"
              onClick={onInterrupt}
              className="rounded-lg px-3 py-1.5 text-xs font-medium"
              style={{ backgroundColor: 'var(--card-subtle)', color: 'var(--status-danger)', border: '0.5px solid var(--app-border)' }}
            >
              中断
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function RunTimeline({
  blocks,
  workspaceRootPath,
  onFocusArtifacts,
}: {
  blocks: ToolCallBlock[];
  workspaceRootPath: string | null;
  onFocusArtifacts?: () => void;
}) {
  const toolBlocks = blocks.filter((block) => block.kind === 'tool_call');
  const runningBlocks = toolBlocks.filter((block) => block.status === 'running');
  const completedBlocks = toolBlocks.filter((block) => block.status === 'completed');
  const errorBlocks = toolBlocks.filter((block) => block.status === 'error');

  const MAX_VISIBLE = 5;
  const visibleCompleted = completedBlocks.slice(-MAX_VISIBLE);
  const hiddenCompletedCount = completedBlocks.length - visibleCompleted.length;

  return (
    <div className="mb-4 space-y-2">
      {(visibleCompleted.length > 0 || errorBlocks.length > 0 || hiddenCompletedCount > 0) && (
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wider" style={{ color: '#9CA3AF' }}>
          EXECUTED TOOLS
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {visibleCompleted.map((block) => (
          <ToolChip key={block.id} block={block} workspaceRootPath={workspaceRootPath} />
        ))}
        {errorBlocks.map((block) => (
          <ToolChip key={block.id} block={block} workspaceRootPath={workspaceRootPath} isError onClick={onFocusArtifacts} />
        ))}
      </div>

      {runningBlocks.length > 0 && (
        <div
          className="flex h-8 items-center gap-2 overflow-hidden rounded-md px-3 font-mono text-xs"
          style={{ backgroundColor: '#111827', color: '#A3BE8C' }}
        >
          <div className="relative flex-1 overflow-hidden text-ellipsis whitespace-nowrap pr-3">
            &gt; {runningBlocks[0].toolName} {formatRelativePath(runningBlocks[0].inputPreview || '', workspaceRootPath)}
            <span className="typing-cursor ml-1 inline-block">▉</span>
          </div>
        </div>
      )}
    </div>
  );
}

function ToolChip({ block, workspaceRootPath, isError = false, onClick }: { block: ToolCallBlock; workspaceRootPath: string | null; isError?: boolean; onClick?: () => void }) {
  const preview = formatRelativePath(block.inputPreview || block.toolName, workspaceRootPath);
  const dotColor = isError ? '#EF4444' : '#10B981';

  return (
    <div
      onClick={isError ? onClick : undefined}
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-xs ${isError ? 'cursor-pointer' : 'cursor-default'}`}
      style={{
        backgroundColor: 'var(--card-subtle)',
        color: '#4B5563',
        border: '0.5px solid var(--app-border)',
      }}
    >
      <span className="h-1 w-1 flex-shrink-0 rounded-full" style={{ backgroundColor: dotColor }} />
      <span className="font-medium">{block.toolName}</span>
      <span className="opacity-70 max-w-[120px] truncate">{preview}</span>
    </div>
  );
}

function AutoMergeState({
  mergeStatus,
  appliedFilesCount,
}: {
  mergeStatus: 'pending' | 'auto_merged' | 'conflict_resolved' | 'needs_approval' | 'failed' | null;
  appliedFilesCount: number;
}) {
  if (mergeStatus === 'needs_approval') {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant="conflict">等待冲突处理</Badge>
        <span className="text-xs" style={{ color: 'var(--app-text-secondary)' }}>
          自动合并遇到冲突，等待人工审批后继续 DAG 调度。
        </span>
      </div>
    );
  }

  if (mergeStatus === 'failed') {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant="failed">自动合并失败</Badge>
        <span className="text-xs" style={{ color: 'var(--app-text-secondary)' }}>
          这次 Run 已完成，但合并到项目目录时失败。
        </span>
      </div>
    );
  }

  if (mergeStatus === 'pending') {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant="running">自动合并中</Badge>
        <span className="text-xs" style={{ color: 'var(--app-text-secondary)' }}>
          正在把隔离工作区的结果合并回项目目录。
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Badge variant="applied">{mergeStatus === 'conflict_resolved' ? '已解决冲突并合并' : '已自动合并到项目'}</Badge>
      <span className="text-xs" style={{ color: 'var(--app-text-secondary)' }}>
        {appliedFilesCount} files
      </span>
    </div>
  );
}

function RunFooter({ children }: { children: ReactNode }) {
  return (
    <div
      className="run-card-footer mt-5 space-y-3 pt-4"
      style={{ borderTop: '0.5px solid var(--app-border)' }}
    >
      {children}
    </div>
  );
}

function AgentTextPanel({ blocks, status }: { blocks: TimelineBlock[]; status: ChatTimelineItem['status'] }) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [collapsible, setCollapsible] = useState(false);
  const running = status === 'queued' || status === 'running';
  const collapsed = !running && collapsible && !expanded;

  const markdown = blocks
    .filter((block): block is Extract<TimelineBlock, { kind: 'agent_text' }> => block.kind === 'agent_text')
    .map((block) => block.content)
    .join('\n\n');

  useEffect(() => {
    if (running) {
      setExpanded(true);
      setAutoScroll(true);
      return;
    }
    setExpanded(false);
  }, [running]);

  useEffect(() => {
    if (!contentRef.current) return;
    setCollapsible(contentRef.current.scrollHeight > 160);
  }, [markdown, running]);

  useEffect(() => {
    if (!running || !autoScroll || !panelRef.current) return;
    panelRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [autoScroll, markdown, running]);

  if (blocks.length === 0) return null;

  return (
    <div
      ref={panelRef}
      className="agent-output-panel relative mt-3 rounded-lg"
      style={{ backgroundColor: '#F9FAFB' }}
      onWheel={() => setAutoScroll(false)}
      onTouchMove={() => setAutoScroll(false)}
    >
      <div
        ref={contentRef}
        className="overflow-hidden p-4"
        style={{ maxHeight: collapsed ? 160 : undefined }}
      >
        <div className="markdown-body max-w-none text-sm leading-[1.6]" style={{ color: '#374151' }}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{normalizeMarkdownTables(stabilizeStreamingMarkdown(markdown))}</ReactMarkdown>
          {running && <span className="typing-cursor ml-1 inline-block">▉</span>}
        </div>
      </div>
      {collapsed && (
        <div
          className="absolute inset-x-0 bottom-0 flex justify-center pb-3 pt-12"
          style={{ background: 'linear-gradient(to bottom, rgba(249,250,251,0), #F9FAFB 62%)' }}
        >
          <button
            type="button"
            className="rounded-md px-3 py-1.5 text-xs font-medium"
            style={{ backgroundColor: '#FFFFFF', color: 'var(--app-text)', border: '0.5px solid var(--app-border)' }}
            onClick={() => setExpanded(true)}
          >
            展开执行细节 ↓
          </button>
        </div>
      )}
      {!running && collapsible && expanded && (
        <div className="flex justify-center px-4 pb-3">
          <button
            type="button"
            className="text-xs font-medium"
            style={{ color: 'var(--app-text-secondary)' }}
            onClick={() => setExpanded(false)}
          >
            ↑ 收起
          </button>
        </div>
      )}
    </div>
  );
}

function stabilizeStreamingMarkdown(markdown: string) {
  let safe = markdown;
  const fenceCount = (safe.match(/```/g) ?? []).length;
  if (fenceCount % 2 === 1) safe += '\n```';

  const boldCount = (safe.match(/\*\*/g) ?? []).length;
  if (boldCount % 2 === 1) safe += '**';

  const italicCount = (safe.match(/(^|[^*])\*([^*\s]|$)/g) ?? []).length;
  if (italicCount % 2 === 1) safe += '*';

  return safe;
}

function TimelineBlockView({ block }: { block: TimelineBlock }) {
  if (block.kind === 'agent_text') {
    return null;
  }

  if (block.kind === 'approval_request') {
    return (
      <div className="rounded-lg px-4 py-3" style={{ backgroundColor: '#FFFBEB', border: '0.5px solid #FDE68A' }}>
        <div className="flex items-center gap-2">
          <Badge variant="needs_confirmation">待确认</Badge>
          <span className="text-sm" style={{ color: 'var(--status-warning)' }}>
            {block.reason}
          </span>
        </div>
      </div>
    );
  }

  if (block.kind === 'file_change_indicator') {
    return null;
  }

  return null;
}

function InlineError({ message }: { message: string }) {
  return (
    <div className="rounded-lg px-3 py-2 text-sm" style={{ backgroundColor: 'var(--card-subtle)', border: '0.5px solid var(--app-border)', color: 'var(--status-danger)' }}>
      {message}
    </div>
  );
}

function secondaryButton(disabled: boolean) {
  return {
    backgroundColor: disabled ? 'var(--card-strong)' : 'rgba(255, 255, 255, 0.78)',
    color: disabled ? 'var(--app-text-secondary)' : 'var(--app-text)',
    border: disabled ? '0.5px solid var(--app-border)' : '0.5px solid rgba(148, 163, 184, 0.4)',
  };
}
