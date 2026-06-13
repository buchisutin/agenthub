import type { AgentFormProps } from './types';

function fieldLabel(label: string) {
  return (
    <div
      className="mb-2 text-[12px] font-medium uppercase"
      style={{ color: '#6B6B64', letterSpacing: '0.04em' }}
    >
      {label}
    </div>
  );
}

function inputStyle() {
  return {
    backgroundColor: '#FFFFFF',
    border: '0.5px solid #E8E7E4',
    color: '#1A1A18',
  } as const;
}

function hintStyle() {
  return { color: '#B5B4AF' } as const;
}

function getRuntimeBadgeStyle(available: boolean | undefined) {
  if (available === true) {
    return {
      label: 'runtime available',
      backgroundColor: '#F0FDF4',
      color: '#15803D',
      borderColor: '#BBF7D0',
    };
  }
  if (available === false) {
    return {
      label: 'runtime unavailable',
      backgroundColor: '#FEF2F2',
      color: '#991B1B',
      borderColor: '#FECACA',
    };
  }
  return {
    label: 'runtime unknown',
    backgroundColor: '#FFFBEB',
    color: '#92400E',
    borderColor: '#FDE68A',
  };
}

function Toggle({
  checked,
  label,
  hint,
  onChange,
}: {
  checked: boolean;
  label: string;
  hint?: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex items-start gap-3 text-left"
    >
      <span
        className="relative mt-0.5 inline-flex h-6 w-10 rounded-full transition-colors"
        style={{ backgroundColor: checked ? '#1A6BCC' : '#D1D0CC' }}
      >
        <span
          className="absolute top-[2px] h-5 w-5 rounded-full bg-white transition-all"
          style={{ left: checked ? '18px' : '2px' }}
        />
      </span>
      <span>
        <div className="text-[13px]" style={{ color: '#1A1A18' }}>
          {label}
        </div>
        {hint && (
          <div className="mt-1 text-xs" style={hintStyle()}>
            {hint}
          </div>
        )}
      </span>
    </button>
  );
}

function deriveMention(name: string, fallbackSlug?: string | null) {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `@${fallbackSlug && name.trim() === '' ? fallbackSlug : normalized || fallbackSlug || 'agent-name'}`;
}

export function AgentForm({
  selectedAgent,
  form,
  loading,
  saving,
  saveState,
  error,
  fieldErrors,
  adapterOptions,
  runtimeChecks,
  selectedRuntimeCheck,
  onChange,
  onClose,
  onSave,
  onDelete,
}: AgentFormProps) {
  const saveLabel = saving
    ? 'Saving...'
    : saveState === 'saved'
      ? '✓ 已保存'
      : saveState === 'failed'
        ? '✗ 失败，重试'
        : selectedAgent
          ? 'Save Agent'
          : 'Create Agent';
  const disabled = saving || Boolean(fieldErrors.name || fieldErrors.slug);
  const mention = deriveMention(form.name, selectedAgent?.slug ?? null);

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-white">
      <div className="flex items-center justify-between px-6 pt-5 pb-4" style={{ borderBottom: '0.5px solid #E8E7E4' }}>
        <div className="text-[15px] font-medium" style={{ color: '#1A1A18' }}>
          {selectedAgent ? 'Edit' : 'Create Agent'}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-md px-2 py-1 text-base leading-none"
          style={{ color: '#6B6B64' }}
        >
          ×
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {loading ? (
          <div className="text-sm" style={{ color: '#6B6B64' }}>
            正在加载 Agent...
          </div>
        ) : (
          <div className="space-y-5">
            <label className="block">
              {fieldLabel('Name')}
              <input
                aria-label="Name"
                value={form.name}
                onChange={(e) => onChange({ ...form, name: e.target.value })}
                className="w-full rounded-lg px-3 py-2 text-[13px] outline-none"
                style={inputStyle()}
              />
              {fieldErrors.name && (
                <div className="mt-1 text-xs" style={{ color: '#C0392B' }}>
                  {fieldErrors.name}
                </div>
              )}
              <div className="mt-2 rounded-lg px-3 py-2.5 text-[12px]" style={{ backgroundColor: '#F7F6F3', color: '#6B6B64', border: '0.5px solid #E8E7E4' }}>
                在聊天中通过 <span style={{ color: '#1A1A18', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{mention}</span> 调用此 Agent
                {fieldErrors.slug && (
                  <div className="mt-1" style={{ color: '#C0392B' }}>
                    {fieldErrors.slug}
                  </div>
                )}
              </div>
            </label>

            <label className="block">
              {fieldLabel('AI 工具')}
              <div className="space-y-2">
                {adapterOptions.map((runtime) => {
                  const selected = form.adapterType === runtime.adapterType;
                  const check = runtimeChecks.find((item) => item.adapterType === runtime.adapterType);
                  const badge = getRuntimeBadgeStyle(check?.available);
                  return (
                    <label
                      key={runtime.adapterType}
                      className="flex cursor-pointer items-center justify-between rounded-md px-3 py-2.5 transition-colors"
                      style={{
                        backgroundColor: selected ? '#EFF8FF' : '#FFFFFF',
                        border: selected ? '0.5px solid #BFDBFE' : '0.5px solid #E8E7E4',
                        borderLeft: selected ? '2px solid #1A6BCC' : '2px solid transparent',
                      }}
                    >
                      <span className="flex items-center gap-3">
                        <span
                          className="inline-flex h-4 w-4 items-center justify-center rounded-full border"
                          style={{ borderColor: selected ? '#1A6BCC' : '#D1D0CC' }}
                        >
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: selected ? '#1A6BCC' : 'transparent' }}
                          />
                        </span>
                        <input
                          type="radio"
                          name="agent-runtime"
                          className="sr-only"
                          checked={selected}
                          onChange={() => onChange({ ...form, adapterType: runtime.adapterType })}
                        />
                        <span className="text-[13px]" style={{ color: '#1A1A18' }}>
                          {runtime.displayName} ({runtime.adapterType})
                        </span>
                      </span>
                      <span
                        className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium"
                        style={{
                          backgroundColor: badge.backgroundColor,
                          color: badge.color,
                          borderColor: badge.borderColor,
                        }}
                      >
                        {badge.label}
                      </span>
                    </label>
                  );
                })}
              </div>
              {selectedRuntimeCheck && !selectedRuntimeCheck.available && (
                <div className="mt-2 text-xs" style={{ color: '#C0392B' }}>
                  Runtime unavailable: {selectedRuntimeCheck.message ?? 'check failed'}
                </div>
              )}
            </label>

            <label className="block">
              {fieldLabel('Instructions')}
              <textarea
                aria-label="Instructions"
                value={form.instructions}
                onChange={(e) => onChange({ ...form, instructions: e.target.value })}
                placeholder="Describe how this agent should behave, what it should focus on, and what it should avoid."
                className="min-h-[120px] w-full resize-y rounded-lg px-3 py-2 text-[13px] outline-none"
                style={{ ...inputStyle(), fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
              />
            </label>

            <div className="space-y-4">
              <div>
                {fieldLabel('Default Agent')}
                <Toggle
                  checked={form.isDefault}
                  label="设为默认 Agent"
                  hint="设置后，未指定 @agent 时将使用此 Agent"
                  onChange={(checked) => onChange({ ...form, isDefault: checked })}
                />
              </div>

              <div>
                {fieldLabel('Enabled')}
                <Toggle
                  checked={form.enabled}
                  label={form.enabled ? '已启用' : '已禁用'}
                  onChange={(checked) => onChange({ ...form, enabled: checked })}
                />
              </div>
            </div>

            {error && (
              <div className="text-xs" style={{ color: '#C0392B' }}>
                {error}
              </div>
            )}
          </div>
        )}
      </div>

      <div
        className="flex items-center justify-between gap-2 px-6 pt-3 pb-5"
        style={{ borderTop: '0.5px solid #E8E7E4' }}
      >
        <div>
          {selectedAgent && !selectedAgent.is_default && (
            <button
              type="button"
              onClick={onDelete}
              className="px-0 py-1.5 text-[13px] font-medium"
              style={{ backgroundColor: 'transparent', color: '#C0392B' }}
            >
              Delete
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={onSave}
          disabled={disabled}
          className="rounded-md px-4 py-1.5 text-[13px] font-medium"
          style={{
            backgroundColor: disabled ? '#D1D0CC' : '#1A6BCC',
            color: '#FFFFFF',
          }}
        >
          {saveLabel}
        </button>
      </div>
    </div>
  );
}
