import { useEffect, useState } from 'react';
import { api } from '../../services/api';
import type { ConversationSummary } from '../../types';
import { formatRelativePath } from '../../utils/pathDisplay';

interface SummaryModalProps {
  conversationId: string;
  onClose: () => void;
}

export function SummaryModal({ conversationId, onClose }: SummaryModalProps) {
  const [summary, setSummary] = useState<ConversationSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.getConversationSummary(conversationId)
      .then((s) => { if (!cancelled) { setSummary(s); setLoading(false); } })
      .catch((e) => { if (!cancelled) { setError(e instanceof Error ? e.message : '加载失败'); setLoading(false); } });
    return () => { cancelled = true; };
  }, [conversationId]);

  function generateMarkdown(): string {
    if (!summary) return '';

    const lines: string[] = [];
    lines.push('# AgentHub 协作结果总结');
    lines.push('');

    // 会话信息
    lines.push('## 会话信息');
    lines.push(`- 会话：${summary.title || '未命名'}`);
    if (summary.workspace) {
      lines.push(`- Workspace：${formatRelativePath(summary.workspace.rootPath)}`);
      if (summary.workspace.isGitRepo !== undefined) {
        lines.push(`- Git 仓库：${summary.workspace.isGitRepo ? '是' : '否'}`);
      }
      if (summary.workspace.previewCapable !== undefined) {
        lines.push(`- Preview 支持：${summary.workspace.previewCapable ? '是' : '否'}`);
      }
    }
    lines.push('');

    // 统计
    lines.push('## 统计概览');
    lines.push(`- 消息数：${summary.counts.messages}`);
    lines.push(`- 任务数：${summary.counts.tasks}`);
    lines.push(`- Run 数：${summary.counts.runs}`);
    lines.push(`- 已完成：${summary.counts.completedRuns}`);
    lines.push(`- 失败：${summary.counts.failedRuns}`);
    lines.push(`- 中断：${summary.counts.interruptedRuns}`);
    lines.push(`- 已 Apply：${summary.counts.appliedRuns}`);
    lines.push(`- 已清理 Workspace：${summary.counts.cleanedWorkspaces}`);
    lines.push(`- 待确认：${summary.counts.pendingConfirmations}`);
    lines.push('');

    // 任务
    if (summary.tasks.length > 0) {
      lines.push('## 任务列表');
      for (const task of summary.tasks) {
        const agent = task.assignedAgentName ? ` (@${task.assignedAgentName})` : '';
        lines.push(`- ${task.title} — ${task.status}${agent}`);
      }
      lines.push('');
    }

    // Run
    if (summary.runs.length > 0) {
      lines.push('## Run 列表');
      for (const run of summary.runs) {
        const agent = run.agentName ? `@${run.agentName}` : run.id.slice(0, 8);
        const ws = run.workspaceMode ? ` [${run.workspaceMode}]` : '';
        const applied = run.applied ? ' ✓ applied' : '';
        const files = run.changedFilesCount !== undefined ? ` ${run.changedFilesCount} files` : '';
        lines.push(`- ${agent} — ${run.status}${ws}${files}${applied}`);
      }
      lines.push('');
    }

    // 修改文件
    if (summary.changedFiles.length > 0) {
      lines.push('## 修改文件');
      for (const f of summary.changedFiles) {
        lines.push(`- \`${formatRelativePath(f.filePath, summary.workspace?.rootPath)}\` — ${f.changeType} — ${f.runId}`);
      }
      lines.push('');
    }

    // 待确认
    if (summary.confirmations.length > 0) {
      lines.push('## 待确认事项');
      for (const c of summary.confirmations) {
        const statusLabel = c.status === 'pending' ? '待确认' : c.status === 'executed' ? '已执行' : c.status === 'rejected' ? '已取消' : c.status;
        lines.push(`- ${c.actionType} — ${statusLabel}`);
      }
      lines.push('');
    }

    lines.push('---');
    lines.push('该总结由 AgentHub 根据当前会话的消息、任务、Run、Diff、Apply 和 Workspace 状态自动生成。');

    return lines.join('\n');
  }

  async function handleCopy() {
    const md = generateMarkdown();
    try {
      await navigator.clipboard.writeText(md);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for environments without clipboard API
      const textarea = document.createElement('textarea');
      textarea.value = md;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  const statusLabel = (s: string) => {
    const map: Record<string, string> = {
      completed: '已完成', failed: '失败', interrupted: '中断',
      running: '运行中', queued: '排队中', cancelled: '已取消',
      todo: '待办', in_progress: '进行中', done: '完成',
      applied: '已 Apply', cleaned: '已清理', ready: '就绪',
      pending: '待确认', executed: '已执行', rejected: '已取消',
    };
    return map[s] ?? s;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6">
      <div
        className="rounded-2xl overflow-hidden w-full max-w-4xl max-h-[88vh] flex flex-col"
        style={{ backgroundColor: 'var(--card-bg)', border: '1px solid var(--app-border)' }}
      >
        <div className="px-5 py-4 flex items-center justify-between flex-shrink-0" style={{ borderBottom: '1px solid var(--app-border)' }}>
          <div>
            <h2 className="text-base font-semibold" style={{ color: 'var(--app-text)' }}>协作结果总结</h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--app-text-secondary)' }}>
              {summary?.title || conversationId.slice(0, 8)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleCopy()}
              className="px-3 py-1.5 rounded text-xs font-medium"
              style={{
                backgroundColor: copied ? 'rgba(5, 150, 105, 0.10)' : 'var(--app-accent)',
                color: copied ? 'var(--status-success)' : 'var(--app-accent-contrast)',
                border: `1px solid ${copied ? 'rgba(5, 150, 105, 0.18)' : 'var(--app-accent)'}`,
              }}
            >
              {copied ? '已复制' : 'Copy Markdown Report'}
            </button>
            <button type="button" onClick={onClose} style={{ color: 'var(--app-text-secondary)' }} className="text-sm">
              关闭
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="w-5 h-5 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--color-accent)', borderTopColor: 'transparent' }} />
            </div>
          ) : error ? (
            <div className="rounded-lg px-3 py-2 text-sm" style={{ backgroundColor: 'rgba(248, 81, 73, 0.10)', color: '#FCA5A5' }}>
              {error}
            </div>
          ) : summary ? (
            <>
              {/* Counts */}
              <Section title="统计概览">
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <CountBadge label="任务数" value={summary.counts.tasks} />
                  <CountBadge label="Run 数" value={summary.counts.runs} />
                  <CountBadge label="改动文件数" value={summary.changedFiles.length} />
                  <CountBadge label="待确认操作数" value={summary.counts.pendingConfirmations} />
                </div>
              </Section>

              {/* Workspace */}
              {summary.workspace && (
                <Section title="工作目录">
                  <div className="text-sm space-y-1" style={{ color: '#C9D1D9' }}>
                    <div className="text-xs font-mono" style={{ color: '#8B949E' }}>{formatRelativePath(summary.workspace.rootPath)}</div>
                    <div className="flex gap-3 text-xs">
                      {summary.workspace.isGitRepo !== undefined && (
                        <span style={{ color: summary.workspace.isGitRepo ? '#3FB950' : '#8B949E' }}>
                          Git: {summary.workspace.isGitRepo ? '是' : '否'}
                        </span>
                      )}
                      {summary.workspace.previewCapable !== undefined && (
                        <span style={{ color: summary.workspace.previewCapable ? '#3FB950' : '#8B949E' }}>
                          Preview: {summary.workspace.previewCapable ? '支持' : '不支持'}
                        </span>
                      )}
                    </div>
                  </div>
                </Section>
              )}

              {/* Tasks */}
              {summary.tasks.length > 0 && (
                <Section title="任务列表">
                  <div className="space-y-1">
                    {summary.tasks.map((task) => (
                      <div key={task.id} className="flex items-center gap-2 text-sm">
                        <span style={{ color: '#C9D1D9' }} className="flex-1 truncate">{task.title}</span>
                        {task.assignedAgentName && (
                          <span className="text-xs" style={{ color: '#58A6FF' }}>@{task.assignedAgentName}</span>
                        )}
                        <span className="text-xs px-2 py-0.5 rounded-full" style={{
                          backgroundColor: task.status === 'completed' || task.status === 'done' ? 'rgba(46,160,67,0.16)' : 'rgba(139,148,158,0.1)',
                          color: task.status === 'completed' || task.status === 'done' ? '#3FB950' : '#8B949E',
                        }}>
                          {statusLabel(task.status)}
                        </span>
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {/* Runs */}
              {summary.runs.length > 0 && (
                <Section title="Run 列表">
                  <div className="space-y-1">
                    {summary.runs.map((run) => (
                      <div key={run.id} className="flex items-center gap-2 text-sm">
                        <span className="text-xs font-mono" style={{ color: '#8B949E' }}>{run.id.slice(0, 8)}</span>
                        {run.agentName && <span style={{ color: '#58A6FF' }}>@{run.agentName}</span>}
                        <span className="text-xs px-2 py-0.5 rounded-full" style={{
                          backgroundColor: run.status === 'completed' ? 'rgba(46,160,67,0.16)' : run.status === 'failed' ? 'rgba(248,81,73,0.16)' : 'rgba(139,148,158,0.1)',
                          color: run.status === 'completed' ? '#3FB950' : run.status === 'failed' ? '#F85149' : '#8B949E',
                        }}>
                          {statusLabel(run.status)}
                        </span>
                        {run.workspaceStatus === 'cleaned' && (
                          <span className="text-xs" style={{ color: '#8B949E' }}>已清理</span>
                        )}
                        {run.applied && (
                          <span className="text-xs" style={{ color: '#BC8CFF' }}>applied</span>
                        )}
                        {run.changedFilesCount !== undefined && (
                          <span className="text-xs" style={{ color: '#8B949E' }}>{run.changedFilesCount} files</span>
                        )}
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {/* Changed Files */}
              {summary.changedFiles.length > 0 && (
                <Section title={`修改文件 (${summary.changedFiles.length})`}>
                  <div className="space-y-0.5 max-h-48 overflow-y-auto">
                    {summary.changedFiles.map((f, i) => (
                      <div key={`${f.runId}-${f.filePath}-${i}`} className="flex items-center gap-2 text-sm">
                        <span className="text-xs px-1.5 py-0.5 rounded" style={{
                          backgroundColor: f.changeType === 'create' ? 'rgba(46,160,67,0.12)' : f.changeType === 'edit' ? 'rgba(210,153,34,0.12)' : 'rgba(139,148,158,0.1)',
                          color: f.changeType === 'create' ? '#3FB950' : f.changeType === 'edit' ? '#E3B341' : '#8B949E',
                        }}>
                          {f.changeType}
                        </span>
                        <span className="text-xs font-mono truncate" style={{ color: '#C9D1D9' }}>{formatRelativePath(f.filePath, summary.workspace?.rootPath)}</span>
                        <span className="text-xs flex-shrink-0" style={{ color: '#484F58' }}>{f.runId}</span>
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {/* Confirmations */}
              {summary.confirmations.length > 0 && (
                <Section title="待确认事项">
                  <div className="space-y-1">
                    {summary.confirmations.map((c) => (
                      <div key={c.id} className="flex items-center gap-2 text-sm">
                        <span className="text-xs" style={{ color: '#C9D1D9' }}>{c.actionType}</span>
                        <span className="text-xs px-2 py-0.5 rounded-full" style={{
                          backgroundColor: c.status === 'pending' ? 'rgba(210,153,34,0.18)' : c.status === 'executed' ? 'rgba(46,160,67,0.16)' : 'rgba(139,148,158,0.1)',
                          color: c.status === 'pending' ? '#D29922' : c.status === 'executed' ? '#3FB950' : '#8B949E',
                        }}>
                          {statusLabel(c.status)}
                        </span>
                      </div>
                    ))}
                  </div>
                </Section>
              )}
            </>
          ) : (
            <div className="text-center py-8 text-sm" style={{ color: '#8B949E' }}>
              暂无协作数据
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-medium mb-2" style={{ color: '#8B949E' }}>{title}</h3>
      {children}
    </div>
  );
}

function CountBadge({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="rounded-lg px-3 py-2 text-center" style={{ backgroundColor: '#161B22', border: '1px solid #30363D' }}>
      <div className="text-lg font-semibold" style={{ color: color ?? '#C9D1D9' }}>{value}</div>
      <div className="text-xs" style={{ color: '#8B949E' }}>{label}</div>
    </div>
  );
}
