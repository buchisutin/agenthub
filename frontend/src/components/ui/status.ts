import type { RunStatus, TaskStatus } from '../../types';
import type { BadgeVariant } from './Badge';

export function getStatusLabel(status: string) {
  const map: Record<string, string> = {
    running: '执行中',
    queued: '排队中',
    completed: '已完成',
    failed: '失败',
    interrupted: '已中断',
    cancelled: '已取消',
    applied: '已应用',
    cleaned: '已清理',
    conflict: '冲突',
    skipped: '已跳过',
    best_effort: '尽力而为',
    needs_confirmation: '待确认',
    pending: '待处理',
    assigned: '已分配',
    in_progress: '进行中',
    done: '已完成',
    todo: '待办',
  };
  return map[status] ?? status;
}

export function getStatusVariant(status: string): BadgeVariant {
  const normalized = status.toLowerCase();
  if (normalized === 'completed' || normalized === 'done') return 'completed';
  if (normalized === 'failed') return 'failed';
  if (normalized === 'interrupted') return 'interrupted';
  if (normalized === 'cancelled') return 'cancelled';
  if (normalized === 'applied') return 'applied';
  if (normalized === 'cleaned') return 'cleaned';
  if (normalized === 'conflict') return 'conflict';
  if (normalized === 'skipped') return 'skipped';
  if (normalized === 'best_effort') return 'best_effort';
  if (normalized === 'needs_confirmation' || normalized === 'pending') return 'needs_confirmation';
  if (normalized === 'running' || normalized === 'queued' || normalized === 'in_progress') return 'running';
  return 'muted';
}

export function getTaskDotColor(status: RunStatus | TaskStatus | string) {
  const normalized = status.toLowerCase();
  if (normalized === 'completed' || normalized === 'done') return '#15803D';
  if (normalized === 'failed') return '#991B1B';
  if (normalized === 'running' || normalized === 'queued' || normalized === 'in_progress') return '#1A6BCC';
  return '#B5B4AF';
}
