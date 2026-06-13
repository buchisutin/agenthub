import { useEffect, useState } from 'react';
import { api } from '../../services/api';
import type { ApprovalRequest, Message } from '../../types';
import { ConfirmationCard } from '../ConfirmationCard';
import { Badge } from '../ui/Badge';
import { formatRelativePath } from '../../utils/pathDisplay';

const INITIAL_VISIBLE_CONFLICTS = 20;

export function ConflictReviewCard({
  message,
  title,
  time,
  avatarLabel,
}: {
  message: Message;
  title: string | null;
  time: string;
  avatarLabel: string;
}) {
  const metadata = message.metadata_json ?? {};
  const runId = typeof metadata.runId === 'string' ? metadata.runId : null;
  const branchName = typeof metadata.branchName === 'string' ? metadata.branchName : null;
  const conflictFiles = Array.isArray(metadata.conflictFiles)
    ? metadata.conflictFiles.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object'))
    : [];
  const [selections, setSelections] = useState<Record<string, 'use_run' | 'use_base' | 'use_llm'>>({});
  const [approval, setApproval] = useState<ApprovalRequest | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_CONFLICTS);
  const [expandedFiles, setExpandedFiles] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    api.getConversationApprovals(message.conversation_id)
      .then((approvals) => {
        if (cancelled) return;
        const latest = approvals
          .filter((item) => item.runId === runId && item.actionType === 'resolve_conflicts')
          .at(-1) ?? null;
        setApproval(latest);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [message.conversation_id, runId]);

  const allSelected = conflictFiles.every((file) => typeof selections[String(file.filePath)] === 'string');
  const visibleConflicts = conflictFiles.slice(0, visibleCount);
  const hasMoreConflicts = visibleCount < conflictFiles.length;

  async function submitResolution() {
    if (!runId || !allSelected || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const nextApproval = await api.requestConflictResolution(
        runId,
        conflictFiles.map((file) => ({
          filePath: String(file.filePath),
          strategy: selections[String(file.filePath)],
        })),
      );
      setApproval(nextApproval);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '提交冲突审查失败');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConfirm(approvalId: string) {
    setConfirmingId(approvalId);
    setError(null);
    try {
      setApproval(await api.approveApproval(approvalId));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '确认执行失败');
    } finally {
      setConfirmingId(null);
    }
  }

  async function handleCancel(approvalId: string) {
    setCancellingId(approvalId);
    setError(null);
    try {
      setApproval(await api.rejectApproval(approvalId));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '取消失败');
    } finally {
      setCancellingId(null);
    }
  }

  return (
    <div className="flex w-full justify-start">
      <div className="min-w-0" style={{ maxWidth: '84%', marginRight: 'auto' }}>
        <div className="mb-2 flex items-center gap-3 px-1">
          <div
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold"
            style={{ backgroundColor: 'var(--card-strong)', color: 'var(--app-text)' }}
          >
            {avatarLabel}
          </div>
          <div className="min-w-0 flex items-center gap-2">
            <span className="truncate text-sm font-medium" style={{ color: 'var(--app-text)' }}>
              {title ?? 'Orchestrator'}
            </span>
            <span className="text-xs" style={{ color: 'var(--app-text-secondary)' }}>
              {time}
            </span>
          </div>
        </div>

        <div className="space-y-3 rounded-2xl px-4 py-4" style={{ backgroundColor: '#FFF7ED', border: '0.5px solid #FED7AA' }}>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="conflict">merge review</Badge>
            {branchName && <Badge variant="muted">{branchName}</Badge>}
          </div>
          <div className="text-sm" style={{ color: 'var(--app-text)' }}>
            {message.content}
          </div>

          {conflictFiles.length > 50 && (
            <div className="rounded-lg px-3 py-2 text-sm" style={{ backgroundColor: '#FEF3C7', border: '0.5px solid #FCD34D', color: '#92400E' }}>
              检测到大量冲突文件（{conflictFiles.length} 个），可能是未排除生成目录导致，请检查 .gitignore 配置
            </div>
          )}

          <div className="space-y-3">
            {visibleConflicts.map((file) => {
              const filePath = String(file.filePath);
              const selected = selections[filePath];
              const llmAvailable = Boolean(file.llmAvailable);
              const expanded = Boolean(expandedFiles[filePath]);
              return (
                <div key={filePath} className="rounded-lg px-3 py-3" style={{ backgroundColor: '#FFFFFF', border: '0.5px solid #FCD34D' }}>
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                      <div className="text-sm font-medium" style={{ color: 'var(--app-text)' }}>{formatRelativePath(filePath)}</div>
                      <div className="text-xs" style={{ color: '#9A3412' }}>{String(file.reason ?? 'Conflict detected')}</div>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      <button
                        type="button"
                        onClick={() => setExpandedFiles((current) => ({ ...current, [filePath]: !current[filePath] }))}
                        className="rounded-lg px-3 py-1.5 text-xs font-medium"
                        style={{
                          backgroundColor: '#FFFFFF',
                          color: 'var(--app-text)',
                          border: '0.5px solid #FCD34D',
                        }}
                        aria-label={`${expanded ? '收起' : '展开'} ${formatRelativePath(filePath)}`}
                      >
                        {expanded ? '收起详情' : '展开详情'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelections((current) => ({ ...current, [filePath]: 'use_run' }))}
                        className="rounded-lg px-3 py-1.5 text-xs font-medium"
                        style={{
                          backgroundColor: selected === 'use_run' ? '#DBEAFE' : '#FFFFFF',
                          color: selected === 'use_run' ? '#1D4ED8' : 'var(--app-text)',
                          border: '0.5px solid #BFDBFE',
                        }}
                      >
                        用 Run 版本
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelections((current) => ({ ...current, [filePath]: 'use_base' }))}
                        className="rounded-lg px-3 py-1.5 text-xs font-medium"
                        style={{
                          backgroundColor: selected === 'use_base' ? '#E7E5E4' : '#FFFFFF',
                          color: selected === 'use_base' ? '#44403C' : 'var(--app-text)',
                          border: '0.5px solid #D6D3D1',
                        }}
                      >
                        保留项目版本
                      </button>
                      {llmAvailable && (
                        <button
                          type="button"
                          onClick={() => setSelections((current) => ({ ...current, [filePath]: 'use_llm' }))}
                          className="rounded-lg px-3 py-1.5 text-xs font-medium"
                          style={{
                            backgroundColor: selected === 'use_llm' ? '#DCFCE7' : '#FFFFFF',
                            color: selected === 'use_llm' ? '#166534' : 'var(--app-text)',
                            border: '0.5px solid #BBF7D0',
                          }}
                        >
                          用 LLM 建议
                        </button>
                      )}
                    </div>
                  </div>
                  {expanded && (
                    <div className="mt-3 grid gap-3 md:grid-cols-3">
                      <PreviewPane title="Base" content={String(file.baseContent ?? '')} />
                      <PreviewPane title="Current" content={String(file.currentContent ?? '')} />
                      <PreviewPane title="Run" content={String(file.runContent ?? '')} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {hasMoreConflicts && (
            <div className="flex justify-start">
              <button
                type="button"
                onClick={() => setVisibleCount((current) => Math.min(current + INITIAL_VISIBLE_CONFLICTS, conflictFiles.length))}
                className="rounded-lg px-3 py-2 text-sm font-medium"
                style={{ backgroundColor: '#FFFFFF', color: 'var(--app-text)', border: '0.5px solid #FCD34D' }}
              >
                显示更多
              </button>
            </div>
          )}

          {!approval && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!allSelected || submitting}
                onClick={() => void submitResolution()}
                className="rounded-lg px-3 py-2 text-sm font-medium"
                style={{
                  backgroundColor: !allSelected || submitting ? 'var(--card-strong)' : '#2563EB',
                  color: !allSelected || submitting ? 'var(--app-text-secondary)' : '#FFFFFF',
                }}
              >
                {submitting ? '提交中...' : '提交冲突处理'}
              </button>
            </div>
          )}

          {approval && (
            <ConfirmationCard
              approval={approval}
              onConfirm={handleConfirm}
              onCancel={handleCancel}
              confirmingId={confirmingId}
              cancellingId={cancellingId}
            />
          )}
          {error && (
            <div className="rounded-lg px-3 py-2 text-sm" style={{ backgroundColor: '#FEF2F2', border: '0.5px solid #FECACA', color: '#991B1B' }}>
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PreviewPane({ title, content }: { title: string; content: string }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-medium" style={{ color: 'var(--app-text-secondary)' }}>{title}</div>
      <pre className="max-h-56 overflow-auto rounded-lg p-3 text-[11px]" style={{ backgroundColor: '#0F172A', color: '#E5E7EB' }}>
        {content || '(empty)'}
      </pre>
    </div>
  );
}
