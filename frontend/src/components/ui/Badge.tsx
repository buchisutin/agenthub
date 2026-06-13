import type { ReactNode } from 'react';

export type BadgeVariant =
  | 'running'
  | 'completed'
  | 'failed'
  | 'interrupted'
  | 'cancelled'
  | 'applied'
  | 'cleaned'
  | 'conflict'
  | 'skipped'
  | 'best_effort'
  | 'needs_confirmation'
  | 'muted';

interface BadgeProps {
  variant: BadgeVariant;
  children: ReactNode;
}

const BADGE_STYLES: Record<BadgeVariant, { backgroundColor: string; color: string; borderColor: string }> = {
  running: { backgroundColor: '#EFF8FF', color: '#1A6BCC', borderColor: '#BFDBFE' },
  completed: { backgroundColor: '#F0FDF4', color: '#15803D', borderColor: '#BBF7D0' },
  failed: { backgroundColor: '#FEF2F2', color: '#991B1B', borderColor: '#FECACA' },
  interrupted: { backgroundColor: '#F5F5F4', color: '#6B6B64', borderColor: '#E8E7E4' },
  cancelled: { backgroundColor: '#F5F5F4', color: '#6B6B64', borderColor: '#E8E7E4' },
  applied: { backgroundColor: '#F0FDF4', color: '#15803D', borderColor: '#BBF7D0' },
  cleaned: { backgroundColor: '#F5F5F4', color: '#6B6B64', borderColor: '#E8E7E4' },
  conflict: { backgroundColor: '#FFF7ED', color: '#9A3412', borderColor: '#FED7AA' },
  skipped: { backgroundColor: '#FFFBEB', color: '#92400E', borderColor: '#FDE68A' },
  best_effort: { backgroundColor: '#FFFBEB', color: '#92400E', borderColor: '#FDE68A' },
  needs_confirmation: { backgroundColor: '#FFFBEB', color: '#92400E', borderColor: '#FDE68A' },
  muted: { backgroundColor: '#F5F5F4', color: '#6B6B64', borderColor: '#E8E7E4' },
};

export function Badge({ variant, children }: BadgeProps) {
  return (
    <span
      className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium"
      style={BADGE_STYLES[variant]}
    >
      {children}
    </span>
  );
}
