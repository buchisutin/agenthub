import { useState } from 'react';
import type { ApprovalRequestBlock } from '../../types';

const API_BASE = 'http://localhost:8000';

interface ToolApprovalCardProps {
  block: ApprovalRequestBlock;
}

export function ToolApprovalCard({ block }: ToolApprovalCardProps) {
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);

  const isPending = block.status === 'pending';
  const isApproved = block.status === 'approved' || block.status === 'executed';
  const isDenied = block.status === 'rejected' || block.status === 'cancelled' || block.status === 'failed';

  async function decide(action: 'approve' | 'reject') {
    if (!isPending || busy) return;
    setBusy(action);
    try {
      await fetch(`${API_BASE}/approvals/${block.approvalId}/${action}`, {
        method: 'POST',
      });
    } finally {
      setBusy(null);
    }
  }

  const toolLabel = block.toolName ?? 'Tool';
  const inputEntries = block.toolInput ? Object.entries(block.toolInput) : [];
  const primaryArg = inputEntries[0];

  return (
    <div
      className="ml-12 mr-auto mt-1 max-w-[85%] rounded-lg overflow-hidden"
      style={{
        border: '0.5px solid',
        borderColor: isPending
          ? 'var(--status-warning)'
          : isApproved
            ? 'var(--status-success, #16a34a)'
            : 'var(--app-border)',
        backgroundColor: isPending
          ? 'color-mix(in srgb, var(--status-warning) 6%, var(--app-bg))'
          : 'var(--card-subtle)',
      }}
    >
      <div className="flex items-start justify-between gap-3 px-3 py-2.5">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold font-mono" style={{ color: 'var(--app-text)' }}>
              {toolLabel}
            </span>
            {isPending && (
              <span
                className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                style={{ backgroundColor: 'color-mix(in srgb, var(--status-warning) 15%, transparent)', color: 'var(--status-warning)' }}
              >
                等待批准
              </span>
            )}
            {isApproved && (
              <span
                className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                style={{ backgroundColor: 'color-mix(in srgb, var(--status-success, #16a34a) 12%, transparent)', color: 'var(--status-success, #16a34a)' }}
              >
                已允许
              </span>
            )}
            {isDenied && (
              <span
                className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                style={{ backgroundColor: 'color-mix(in srgb, var(--status-danger) 12%, transparent)', color: 'var(--status-danger)' }}
              >
                已拒绝
              </span>
            )}
          </div>

          {primaryArg && (
            <div
              className="rounded px-2 py-1 font-mono text-[11px] break-all"
              style={{ backgroundColor: 'var(--card-strong)', color: 'var(--app-text-secondary)' }}
            >
              {String(primaryArg[1])}
            </div>
          )}

          {inputEntries.length > 1 && (
            <div className="text-[10px]" style={{ color: 'var(--app-text-secondary)' }}>
              +{inputEntries.length - 1} 个参数
            </div>
          )}
        </div>

        {isPending && (
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void decide('reject')}
              className="rounded-md px-3 py-1.5 text-xs"
              style={{
                backgroundColor: 'transparent',
                color: 'var(--app-text-secondary)',
                border: '0.5px solid var(--app-border)',
                opacity: busy ? 0.6 : 1,
              }}
            >
              拒绝
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void decide('approve')}
              className="rounded-md px-3 py-1.5 text-xs font-medium"
              style={{
                backgroundColor: 'var(--app-accent)',
                color: '#fff',
                border: '0.5px solid var(--app-accent)',
                opacity: busy ? 0.6 : 1,
              }}
            >
              {busy === 'approve' ? '处理中…' : '允许'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
