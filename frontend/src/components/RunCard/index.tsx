import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '../../services/api';
import { applyRunDetail } from '../../store/timeline';
import { useApp } from '../../store/useApp';
import { ConfirmationCard } from '../ConfirmationCard';
import { Badge } from '../ui/Badge';
import { getStatusLabel, getStatusVariant } from '../ui/status';
import { normalizeMarkdownTables } from '../../utils/markdown';
import { formatRelativePath } from '../../utils/pathDisplay';
import type {
  ApplyCheckResult,
  ApprovalRequest as ApprovalRequestType,
  ChatTimelineItem,
  FileChange,
  RunChangeApplication,
  RunWorkspace,
  TimelineBlock,
  ToolCallBlock,
} from '../../types';

type ApplyChangesError = Error & {
  statusCode?: number;
  check?: ApplyCheckResult;
};

export function RunCard({
  item,
  isActive,
  onInterrupt,
  onFocusArtifacts,
}: {
  item: ChatTimelineItem;
  isActive: boolean;
  onInterrupt: () => void;
  onFocusArtifacts?: (runId: string, tab: 'diff' | 'preview' | 'summary') => void;
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
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applyCheck, setApplyCheck] = useState<ApplyCheckResult | null>(null);
  const [checkingApply, setCheckingApply] = useState(false);
  const [changeConfirmation, setChangeConfirmation] = useState<ApprovalRequestType | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [confirmationError, setConfirmationError] = useState<string | null>(null);
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
    api.getConversationApprovals(item.conversationId).then((approvals) => {
      if (cancelled) return;
      const runApprovals = approvals.filter(
        (a) => a.runId === item.runId && (a.actionType === 'apply_changes' || a.actionType === 'apply_and_commit'),
      );
      const latest = runApprovals.at(-1) ?? null;
      if (latest) setChangeConfirmation(latest);
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [item.conversationId, item.runId, item.status, shouldLoadRunMeta]);

  useEffect(() => {
    if (item.status === 'failed' || item.status === 'interrupted' || item.error) {
      setDetailsExpanded(true);
      return;
    }
    setDetailsExpanded(false);
  }, [item.error, item.runId, item.status]);

  const toolBlocks = item.blocks.filter((block): block is ToolCallBlock => block.kind === 'tool_call');
  const eventCount = item.eventCount ?? 0;
  const canLoadDetail = !item.detailsLoaded && eventCount > 0;
  const hasFailedTool = toolBlocks.some((block) => block.status === 'error');
  const isCleaned = runWorkspace?.status === 'cleaned';
  const isApplied = changeApp?.status === 'applied';
  const canShowActions = item.status === 'completed';
  const conflictFiles = (applyCheck?.files ?? []).filter((file) => file.status === 'conflict');
  const hasFileChanges = fileChanges.length > 0;
  const isAutoMergeRun = mergeMode === 'auto';
  const hasActionBar = canShowActions && hasFileChanges && !isApplied && !isCleaned && !isAutoMergeRun;
  const showNoChangesState = canShowActions && !hasFileChanges && !isApplied && !isCleaned && !isAutoMergeRun;
  const hasPendingProjectChanges = hasActionBar && conflictFiles.length === 0;
  const showAutoMergeState = canShowActions && isAutoMergeRun && !isCleaned;
  const runSummaryLabel = item.prompt.trim() || item.runId.slice(0, 8);
  const appliedFilesCount = changeApp?.appliedFiles.length ?? fileChanges.length;
  const canCollapse = item.status === 'completed' || running;
  const showCollapsedSummary = canCollapse && !detailsExpanded;

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

  async function requestChangeApproval(requestApproval: () => Promise<ApprovalRequestType>) {
    if (checkingApply || isApplied) return;
    if (changeConfirmation && changeConfirmation.status !== 'rejected') return;
    setCheckingApply(true);
    setApplyError(null);
    setApplyCheck(null);
    try {
      const check = await api.checkRunApply(item.runId);
      setApplyCheck(check);
      if (!check.canApply) {
        setCheckingApply(false);
        return;
      }
      setCheckingApply(false);
      try {
        const confirmation = await requestApproval();
        setChangeConfirmation(confirmation);
        setApplyCheck(null);
      } catch (e: unknown) {
        const applyErr = e as ApplyChangesError;
        if (applyErr.statusCode === 409 && applyErr.check) {
          setApplyCheck(applyErr.check);
          setApplyError('Apply disabled due to conflicts');
          return;
        }
        setApplyError(e instanceof Error ? e.message : 'Apply failed');
      }
    } catch (e: unknown) {
      setApplyError(e instanceof Error ? e.message : 'Check failed');
      setCheckingApply(false);
    }
  }

  async function handleApplyChanges() {
    await requestChangeApproval(() => api.requestApplyChanges(item.runId));
  }

  async function handleApplyAndCommit() {
    await requestChangeApproval(() => api.requestApplyAndCommit(item.runId));
  }

  async function handleConfirm(approvalId: string) {
    setConfirmingId(approvalId);
    setConfirmationError(null);
    try {
      const updated = await api.approveApproval(approvalId);
      if (updated.actionType === 'apply_changes' || updated.actionType === 'apply_and_commit') {
        setChangeConfirmation(updated);
        if (updated.status === 'executed') {
          const app = await api.getRunChangeApplication(item.runId);
          setChangeApp(app);
        }
      }
    } catch (e: unknown) {
      setConfirmationError(e instanceof Error ? e.message : 'Confirmation failed');
    } finally {
      setConfirmingId(null);
    }
  }

  async function handleCancel(approvalId: string) {
    setCancellingId(approvalId);
    setConfirmationError(null);
    try {
      const updated = await api.rejectApproval(approvalId);
      if (updated.actionType === 'apply_changes' || updated.actionType === 'apply_and_commit') {
        setChangeConfirmation(updated);
      }
    } catch (e: unknown) {
      setConfirmationError(e instanceof Error ? e.message : 'Cancel failed');
    } finally {
      setCancellingId(null);
    }
  }

  return (
    <div ref={cardRef} id={`run-card-${item.runId}`} className="agenthub-card space-y-4 p-5">
      <RunHeader
        item={item}
        runWorkspace={runWorkspace}
        toolCount={toolBlocks.length}
        isActive={isActive}
        onInterrupt={onInterrupt}
        summaryLabel={runSummaryLabel}
        fileCount={appliedFilesCount}
        detailsExpanded={detailsExpanded}
        canCollapse={canCollapse}
        onToggleDetails={() => setDetailsExpanded((current) => !current)}
      />

      {showCollapsedSummary ? (
        <RunCollapsedSummary
          item={item}
          summaryLabel={runSummaryLabel}
          fileCount={appliedFilesCount}
        />
      ) : (
        <>

          <div className="space-y-3">
            {running ? (
              <RunningSummary toolCount={toolBlocks.length} />
            ) : toolBlocks.length > 0 ? (
              <RunTimeline blocks={toolBlocks} autoExpand={hasFailedTool} workspaceRootPath={runWorkspace?.rootPath ?? null} />
            ) : canLoadDetail ? (
              <button
                type="button"
                onClick={() => void handleLoadDetail()}
                disabled={loadingDetail}
                className="rounded-lg px-3 py-2 text-sm font-medium"
                style={secondaryButton(loadingDetail)}
              >
                {loadingDetail ? `正在加载 ${eventCount} 条执行记录...` : `加载 ${eventCount} 条执行记录`}
              </button>
            ) : null}
            {item.blocks
              .filter((block) => block.kind !== 'tool_call')
              .map((block) => (
                <TimelineBlockView key={block.id} block={block} workspaceRootPath={runWorkspace?.rootPath ?? null} />
              ))}
          </div>

          {hasActionBar && (
            <RunActionBar
              onFocusArtifacts={onFocusArtifacts ? () => onFocusArtifacts(item.runId, 'diff') : undefined}
              onApplyChanges={() => void handleApplyChanges()}
              onApplyAndCommit={() => void handleApplyAndCommit()}
              hasFileChanges={hasFileChanges}
              isApplied={Boolean(isApplied)}
              isCleaned={Boolean(isCleaned)}
              checkingApply={checkingApply}
              applyDisabled={conflictFiles.length > 0 || Boolean(isApplied)}
            />
          )}

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
          {isApplied && changeApp && (
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
          {changeApp?.status === 'skipped' && (
            <div className="flex items-center gap-2">
              <Badge variant="muted">无可应用改动</Badge>
              <span className="hidden">No changes</span>
            </div>
          )}
          {conflictFiles.length > 0 && <ConflictPanel applyCheck={applyCheck} workspaceRootPath={runWorkspace?.rootPath ?? null} />}
          {changeConfirmation && (
            <ConfirmationCard
              approval={changeConfirmation}
              onConfirm={handleConfirm}
              onCancel={handleCancel}
              confirmingId={confirmingId}
              cancellingId={cancellingId}
            />
          )}
          {confirmationError && <InlineError message={confirmationError} />}
          {applyError && <InlineError message={applyError} />}
          {detailError && <InlineError message={detailError} />}
          {item.error && <InlineError message={item.error} />}
        </>
      )}
    </div>
  );
}

function RunHeader({
  item,
  runWorkspace,
  toolCount,
  isActive,
  onInterrupt,
  summaryLabel,
  fileCount,
  detailsExpanded,
  canCollapse,
  onToggleDetails,
}: {
  item: ChatTimelineItem;
  runWorkspace: RunWorkspace | null;
  toolCount: number;
  isActive: boolean;
  onInterrupt: () => void;
  summaryLabel: string;
  fileCount: number;
  detailsExpanded: boolean;
  canCollapse: boolean;
  onToggleDetails: () => void;
}) {
  const duration = useMemo(() => {
    const end = item.finishedAt ? new Date(item.finishedAt).getTime() : Date.now();
    const start = new Date(item.startedAt).getTime();
    const seconds = Math.max(1, Math.round((end - start) / 1000));
    return `${seconds}s`;
  }, [item.finishedAt, item.startedAt]);

  const workspaceModeLabel = runWorkspace?.mode === 'git_worktree'
    ? 'worktree'
    : runWorkspace?.mode === 'git_clone'
      ? 'clone'
      : runWorkspace?.mode === 'copy'
        ? 'copy (legacy)'
      : 'legacy';

  return (
    <div className="flex items-start gap-3">
      <div
        className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold"
        style={{ backgroundColor: 'var(--card-strong)', color: 'var(--app-text)' }}
      >
        {(item.agentName ?? 'A').slice(0, 1).toUpperCase()}
      </div>
      <div className="flex-1 space-y-2">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold" style={{ color: 'var(--app-text)' }}>
              {item.agentName ?? item.agentId}
            </span>
            <Badge variant={getStatusVariant(item.status)}>{getStatusLabel(item.status)}</Badge>
            <span className="font-mono text-xs" style={{ color: 'var(--app-text-secondary)' }}>
              {item.runId.slice(0, 8)}
            </span>
            {runWorkspace && <Badge variant={runWorkspace.status === 'cleaned' ? 'cleaned' : 'muted'}>{runWorkspace.status === 'cleaned' ? '已清理' : workspaceModeLabel}</Badge>}
            {runWorkspace?.status === 'cleaned' && <span className="hidden">cleaned</span>}
            <span className="text-xs" style={{ color: 'var(--app-text-secondary)' }}>
              {toolCount} tools
            </span>
            <span className="text-xs" style={{ color: 'var(--app-text-secondary)' }}>
              {duration}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {canCollapse && (
              <button
                type="button"
                onClick={onToggleDetails}
                className="rounded-lg px-3 py-1.5 text-xs font-medium"
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
                style={{ backgroundColor: '#FEF2F2', color: '#991B1B', border: '0.5px solid #FECACA' }}
              >
                中断
              </button>
            )}
          </div>
        </div>
        <div className="text-xs truncate" style={{ color: 'var(--app-text-secondary)' }}>
          {summaryLabel}
          {item.status === 'completed' ? ` · ${fileCount} files` : ''}
        </div>
      </div>
    </div>
  );
}

function RunTimeline({
  blocks,
  autoExpand,
  workspaceRootPath,
}: {
  blocks: ToolCallBlock[];
  autoExpand: boolean;
  workspaceRootPath: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const failedCount = blocks.filter((block) => block.status === 'error').length;
  const completedCount = blocks.filter((block) => block.status === 'completed').length;
  const runningCount = blocks.filter((block) => block.status === 'running').length;

  return (
    <div className="space-y-2">
      <button
        type="button"
        className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left"
        onClick={() => setExpanded((value) => !value)}
        style={{ backgroundColor: 'var(--card-subtle)', border: '0.5px solid var(--app-border)' }}
      >
        <div className="min-w-0">
          <div className="text-sm font-medium" style={{ color: 'var(--app-text)' }}>
            工具调用
          </div>
          <div className="mt-1 text-xs" style={{ color: failedCount > 0 ? 'var(--status-danger)' : 'var(--app-text-secondary)' }}>
            {blocks.length} 条
            {completedCount > 0 ? ` · ${completedCount} 已完成` : ''}
            {runningCount > 0 ? ` · ${runningCount} 执行中` : ''}
            {failedCount > 0 ? ` · ${failedCount} 失败` : ''}
          </div>
        </div>
        <span className="text-xs font-medium" style={{ color: 'var(--app-accent)' }}>
          {expanded ? '收起' : '展开'}
        </span>
      </button>

      {expanded && (
        <div className="space-y-2">
          {blocks.map((block) => (
            <ToolTimelineRow key={block.id} block={block} expanded={autoExpand && block.status === 'error'} workspaceRootPath={workspaceRootPath} />
          ))}
        </div>
      )}
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

function RunningSummary({ toolCount }: { toolCount: number }) {
  return (
    <div className="rounded-lg px-3 py-3" style={{ backgroundColor: 'var(--card-subtle)', border: '0.5px solid var(--app-border)' }}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium" style={{ color: 'var(--app-text)' }}>
            正在工作...
          </div>
          <div className="mt-1 text-xs" style={{ color: 'var(--app-text-secondary)' }}>
            {toolCount > 0 ? `已记录 ${toolCount} 条工具调用，点击展开查看详情` : '等待更多执行事件'}
          </div>
        </div>
        <div className="flex gap-1 px-1">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="h-2 w-2 rounded-full animate-bounce"
              style={{ backgroundColor: 'var(--color-accent)', animationDelay: `${i * 0.15}s` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function RunCollapsedSummary({
  item,
  summaryLabel,
  fileCount,
}: {
  item: ChatTimelineItem;
  summaryLabel: string;
  fileCount: number;
}) {
  return (
    <div className="rounded-lg px-3 py-2 text-sm" style={{ backgroundColor: 'var(--card-subtle)', border: '0.5px solid var(--app-border)', color: 'var(--app-text)' }}>
      {item.status === 'completed'
        ? `${item.agentName ?? item.agentId} 完成了「${summaryLabel}」 · ${fileCount} files`
        : `${item.agentName ?? item.agentId} 正在处理「${summaryLabel}」`}
    </div>
  );
}

function ToolTimelineRow({ block, expanded, workspaceRootPath }: { block: ToolCallBlock; expanded: boolean; workspaceRootPath: string | null }) {
  const [open, setOpen] = useState(expanded);
  const pill = formatRelativePath(block.inputPreview || block.toolName, workspaceRootPath);

  useEffect(() => {
    if (expanded) {
      setOpen(true);
    }
  }, [expanded]);

  return (
    <div className="rounded-lg border px-3 py-3" style={{ borderColor: 'var(--app-border)', backgroundColor: 'var(--card-subtle)' }}>
      <button type="button" className="flex w-full items-start justify-between gap-3 text-left" onClick={() => setOpen((value) => !value)}>
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 text-sm" style={{ color: block.status === 'error' ? 'var(--status-danger)' : block.status === 'running' ? 'var(--status-running)' : 'var(--status-success)' }}>
            {block.status === 'error' ? '✕' : block.status === 'running' ? '◌' : '✓'}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium" style={{ color: 'var(--app-text)' }}>
                {block.toolName}
              </span>
              <code
                className="rounded-full px-2 py-0.5 text-[11px]"
                style={{ backgroundColor: 'var(--card-bg)', color: 'var(--app-text-secondary)', border: '0.5px solid var(--app-border)' }}
              >
                {pill}
              </code>
            </div>
            {block.summary && (
              <div className="mt-1 text-xs" style={{ color: 'var(--app-text-secondary)' }}>
                {block.summary}
              </div>
            )}
          </div>
        </div>
        <Badge variant={block.status === 'error' ? 'failed' : block.status === 'running' ? 'running' : 'completed'}>
          {block.status === 'error' ? 'failed' : block.status}
        </Badge>
      </button>
      {open && (block.resultContent || block.partialJson) && (
        <div className="mt-3 rounded-lg px-3 py-3 text-xs" style={{ backgroundColor: 'var(--card-bg)', border: '0.5px solid var(--app-border)' }}>
          <pre className="whitespace-pre-wrap break-all font-mono" style={{ margin: 0, color: 'var(--app-text-secondary)' }}>
            {truncateContent(formatToolOutput(block.resultContent ?? block.partialJson, workspaceRootPath), 40)}
          </pre>
        </div>
      )}
    </div>
  );
}

function RunActionBar({
  onFocusArtifacts,
  onApplyChanges,
  onApplyAndCommit,
  hasFileChanges,
  isApplied,
  isCleaned,
  checkingApply,
  applyDisabled,
}: {
  onFocusArtifacts?: () => void;
  onApplyChanges: () => void;
  onApplyAndCommit: () => void;
  hasFileChanges: boolean;
  isApplied: boolean;
  isCleaned: boolean;
  checkingApply: boolean;
  applyDisabled: boolean;
}) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <div className="flex items-center gap-2 flex-wrap">
        {hasFileChanges && !isCleaned && onFocusArtifacts && (
          <button type="button" aria-label="查看产物" onClick={onFocusArtifacts} className="rounded-lg px-3 py-2 text-sm font-medium" style={secondaryButton(false)}>
            查看产物
          </button>
        )}
        {hasFileChanges && !isCleaned && !isApplied && (
          <button type="button" aria-label="Apply Changes" onClick={onApplyChanges} disabled={applyDisabled || checkingApply} className="rounded-lg px-3 py-2 text-sm font-medium" style={primaryButton(applyDisabled || checkingApply)}>
            {checkingApply ? '检查中...' : '应用到项目'}
          </button>
        )}
        {hasFileChanges && !isCleaned && !isApplied && (
          <button type="button" aria-label="Apply and Commit" onClick={onApplyAndCommit} disabled={applyDisabled || checkingApply} className="rounded-lg px-3 py-2 text-sm font-medium" style={secondaryAccentButton(applyDisabled || checkingApply)}>
            {checkingApply ? '检查中...' : '应用并提交'}
          </button>
        )}
      </div>
    </div>
  );
}

function ConflictPanel({ applyCheck, workspaceRootPath }: { applyCheck: ApplyCheckResult | null; workspaceRootPath: string | null }) {
  if (!applyCheck || applyCheck.canApply) return null;
  const conflicts = applyCheck.files.filter((file) => file.status === 'conflict');
  const skipped = applyCheck.files.filter((file) => file.status === 'skipped');
  return (
    <div
      className="rounded-lg px-4 py-3"
      style={{ backgroundColor: '#FEF2F2', border: '0.5px solid #FECACA', borderLeft: '4px solid var(--status-danger)' }}
    >
      <div className="mb-2 flex items-center gap-2">
        <Badge variant="conflict">冲突</Badge>
        <span className="text-sm font-medium" style={{ color: '#991B1B' }}>
          应用前需要先解决冲突
        </span>
      </div>
      <span className="hidden">Apply disabled due to conflicts</span>
      <div className="mb-2 flex gap-3 text-xs" style={{ color: '#7F1D1D' }}>
        <span>{applyCheck.summary.safe} safe</span>
        <span>{applyCheck.summary.conflict} conflict</span>
        <span>{applyCheck.summary.skipped} skipped</span>
      </div>
      <div className="space-y-1 text-xs" style={{ color: '#7F1D1D' }}>
        {conflicts.map((file) => (
          <div key={file.filePath}>
            {formatRelativePath(file.filePath, workspaceRootPath)} · {file.reason}
          </div>
        ))}
        {skipped.map((file) => (
          <div key={file.filePath}>
            {formatRelativePath(file.filePath, workspaceRootPath)} · {file.reason}
          </div>
        ))}
      </div>
    </div>
  );
}

function TimelineBlockView({ block, workspaceRootPath }: { block: TimelineBlock; workspaceRootPath: string | null }) {
  if (block.kind === 'agent_text') {
    return (
      <div className="px-1 py-1">
        <div className="markdown-body text-sm">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{normalizeMarkdownTables(block.content)}</ReactMarkdown>
        </div>
      </div>
    );
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
    return (
      <div className="rounded-lg px-3 py-2 text-sm" style={{ backgroundColor: '#EFF8FF', border: '0.5px solid #BFDBFE', color: 'var(--app-text)' }}>
        {block.changeType === 'create' ? '新增' : '修改'} {formatRelativePath(block.filePath, workspaceRootPath)}
      </div>
    );
  }

  return null;
}

function InlineError({ message }: { message: string }) {
  return (
    <div className="rounded-lg px-3 py-2 text-sm" style={{ backgroundColor: '#FEF2F2', border: '0.5px solid #FECACA', color: '#991B1B' }}>
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

function primaryButton(disabled: boolean) {
  return {
    backgroundColor: disabled ? 'var(--card-strong)' : '#2563EB',
    color: disabled ? 'var(--app-text-secondary)' : '#FFFFFF',
    border: `0.5px solid ${disabled ? 'var(--app-border)' : '#2563EB'}`,
  };
}

function secondaryAccentButton(disabled: boolean) {
  return {
    backgroundColor: disabled ? 'var(--card-strong)' : '#DBEAFE',
    color: disabled ? 'var(--app-text-secondary)' : '#1D4ED8',
    border: `0.5px solid ${disabled ? 'var(--app-border)' : '#93C5FD'}`,
  };
}

function truncateContent(content: string, maxLines: number) {
  const lines = content.split('\n');
  if (lines.length <= maxLines) return content;
  return `${lines.slice(0, maxLines).join('\n')}\n...`;
}

function formatToolOutput(content: string, workspaceRootPath: string | null) {
  return content.replace(/\/[^\s"']+/g, (value) => formatRelativePath(value, workspaceRootPath));
}
