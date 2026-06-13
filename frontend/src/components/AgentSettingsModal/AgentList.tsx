import type { RuntimeAdapterCheck } from '../../types';
import type { AgentListProps } from './types';

function getRuntimeBadgeStyle(check: RuntimeAdapterCheck | undefined) {
  if (!check) {
    return {
      label: 'unknown',
      backgroundColor: '#FFFBEB',
      color: '#92400E',
      borderColor: '#FDE68A',
    };
  }
  if (check.available) {
    return {
      label: 'available',
      backgroundColor: '#F0FDF4',
      color: '#15803D',
      borderColor: '#BBF7D0',
    };
  }
  return {
    label: 'unavailable',
    backgroundColor: '#FEF2F2',
    color: '#991B1B',
    borderColor: '#FECACA',
  };
}

function getDefaultBadgeStyle() {
  return {
    backgroundColor: '#EFF8FF',
    color: '#1A6BCC',
    borderColor: '#BFDBFE',
  };
}

function getDisabledBadgeStyle() {
  return {
    backgroundColor: '#F5F5F4',
    color: '#B5B4AF',
    borderColor: '#E8E7E4',
  };
}

export function AgentList({
  agents,
  loading,
  selectedAgentId,
  createMode,
  runtimeChecks,
  onSelectAgent,
  onCreateNew,
}: AgentListProps) {
  const orderedAgents = agents
    .map((agent, index) => ({ agent, index }))
    .sort((left, right) => {
      if (left.agent.enabled !== right.agent.enabled) {
        return left.agent.enabled ? -1 : 1;
      }
      return left.index - right.index;
    })
    .map(({ agent }) => agent);

  return (
    <div
      className="flex h-full w-[260px] flex-col"
      style={{ backgroundColor: '#FAFAF9', borderRight: '0.5px solid #E8E7E4' }}
    >
      <div className="px-4 pt-4 pb-3" style={{ borderBottom: '0.5px solid #E8E7E4' }}>
        <div className="text-[15px] font-medium" style={{ color: '#1A1A18' }}>
          Agents
        </div>
      </div>

      <div className="px-3 py-3">
        <button
          type="button"
          onClick={onCreateNew}
          className="w-full rounded-lg px-3 py-2.5 text-[13px] transition-colors"
          style={{
            backgroundColor: createMode ? '#FFFFFF' : '#FFFFFF',
            color: '#6B6B64',
            border: '0.5px solid #E8E7E4',
          }}
        >
          + 新建 Agent
          <span className="sr-only">New Agent</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-3">
        {loading ? (
          <div className="px-2 py-4 text-sm" style={{ color: '#6B6B64' }}>
            正在加载 Agent...
          </div>
        ) : (
          <div className="space-y-1">
            {orderedAgents.map((agent) => {
              const selected = !createMode && selectedAgentId === agent.id;
              const runtimeCheck = runtimeChecks.find((runtime) => runtime.adapterType === agent.adapter_type);
              const runtimeStyle = getRuntimeBadgeStyle(runtimeCheck);
              return (
                <button
                  key={agent.id}
                  type="button"
                  onClick={() => onSelectAgent(agent.id)}
                  className="w-full rounded-md px-3 py-2.5 text-left transition-colors"
                  style={{
                    backgroundColor: selected ? '#EFF8FF' : 'transparent',
                    borderLeft: selected ? '2px solid #1A6BCC' : '2px solid transparent',
                  }}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[14px] font-medium" style={{ color: '#1A1A18' }}>
                      @{agent.slug}
                    </span>
                    {agent.is_default && (
                      <span
                        className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium"
                        style={getDefaultBadgeStyle()}
                      >
                        default
                      </span>
                    )}
                    {!agent.enabled && (
                      <span
                        className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium"
                        style={getDisabledBadgeStyle()}
                      >
                        disabled
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-xs" style={{ color: '#6B6B64' }}>
                    {agent.adapter_type} · runtime {runtimeStyle.label}
                  </div>
                  <div className="mt-2">
                    <span
                      className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium"
                      style={{
                        backgroundColor: runtimeStyle.backgroundColor,
                        color: runtimeStyle.color,
                        borderColor: runtimeStyle.borderColor,
                      }}
                    >
                      runtime {runtimeStyle.label}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
