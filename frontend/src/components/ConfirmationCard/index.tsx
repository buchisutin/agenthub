import { Badge } from '../ui/Badge';
import type { ApprovalRequest } from '../../types';

interface ConfirmationCardProps {
  approval: ApprovalRequest;
  onConfirm: (id: string) => void;
  onCancel: (id: string) => void;
  confirmingId: string | null;
  cancellingId: string | null;
}

export function ConfirmationCard({
  approval,
  onConfirm,
  onCancel,
  confirmingId,
  cancellingId,
}: ConfirmationCardProps) {
  const isPending = approval.status === 'pending';
  const isExecuted = approval.status === 'executed';
  const isCancelled = approval.status === 'rejected' || approval.status === 'cancelled';
  const isProcessing = confirmingId === approval.id || cancellingId === approval.id;
  const actionTypeLabel = approval.actionType === 'apply_changes'
    ? '应用改动'
    : approval.actionType === 'apply_and_commit'
      ? '应用并提交'
      : approval.actionType === 'resolve_conflicts'
        ? '冲突审查'
      : '清理工作区';
  const executedAt = approval.executedAt ?? approval.decidedAt;

  return (
    <div
      className="ml-4 rounded-lg px-4 py-4"
      style={{
        backgroundColor: isPending ? '#FEF2F2' : '#F5F5F4',
        border: '0.5px solid #FECACA',
        borderLeft: '4px solid var(--status-danger)',
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold" style={{ color: '#7F1D1D' }}>
              ⚠ 确认操作
            </span>
            <Badge variant="failed">高风险</Badge>
            <Badge variant="muted">{actionTypeLabel}</Badge>
            {isPending && (
              <>
                <Badge variant="needs_confirmation">待确认</Badge>
                <span className="hidden">Needs confirmation</span>
              </>
            )}
            {isExecuted && (
              <>
                <Badge variant="applied">已执行</Badge>
                <span className="hidden">Executed</span>
              </>
            )}
            {isCancelled && (
              <>
                <Badge variant="cancelled">已取消</Badge>
                <span className="hidden">Cancelled</span>
              </>
            )}
          </div>
          <div className="text-sm" style={{ color: '#7F1D1D' }}>
            {approval.description ?? approval.title}
          </div>
          {approval.errorMessage && (
            <div className="text-xs" style={{ color: 'var(--status-danger)' }}>
              {approval.errorMessage}
            </div>
          )}
          {isExecuted && executedAt && (
            <div className="text-xs" style={{ color: 'var(--app-text-secondary)' }}>
              已执行 · {new Date(executedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
            </div>
          )}
          {isCancelled && (
            <div className="text-xs" style={{ color: 'var(--app-text-secondary)' }}>
              已取消
            </div>
          )}
        </div>
        {isPending && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Cancel"
              disabled={isProcessing}
              onClick={() => onCancel(approval.id)}
              className="rounded-lg px-4 py-2 text-sm"
              style={{
                backgroundColor: 'transparent',
                color: 'var(--app-text-secondary)',
                border: '0.5px solid var(--app-border)',
              }}
            >
              取消
            </button>
            <button
              type="button"
              aria-label="Confirm"
              disabled={isProcessing}
              onClick={() => onConfirm(approval.id)}
              className="rounded-lg px-4 py-2 text-sm font-medium"
              style={{
                backgroundColor: 'var(--status-danger)',
                color: '#FFFFFF',
                border: '0.5px solid var(--status-danger)',
                opacity: isProcessing ? 0.7 : 1,
              }}
            >
              确认执行
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
