import type {
  ChatTimelineItem,
  FileChangeIndicatorBlock,
  Run,
  RunSummary,
  RuntimeSocketEvent,
  TimelineBlock,
  ToolCallBlock,
  ToolStartedEvent,
} from '../types';

function getString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function getRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function countLines(value: string | null | undefined) {
  if (!value) {
    return 0;
  }
  return value.replace(/\n$/, '').split('\n').length;
}

function getToolResultKind(toolName: string): ToolCallBlock['resultKind'] {
  if (toolName === 'Read') return 'read';
  if (toolName === 'Bash') return 'bash';
  if (toolName === 'Write' || toolName === 'Edit' || toolName === 'NotebookEdit') return 'write';
  return 'generic';
}

function isWriteToolName(toolName: string) {
  return (
    toolName === 'Write' ||
    toolName === 'Edit' ||
    toolName === 'MultiEdit' ||
    toolName === 'NotebookEdit' ||
    toolName === 'Create'
  );
}

function getDiffStat(content: string | null) {
  if (!content) {
    return null;
  }

  let additions = 0;
  let deletions = 0;
  for (const line of content.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) additions += 1;
    if (line.startsWith('-')) deletions += 1;
  }

  if (additions === 0 && deletions === 0) {
    return null;
  }

  return `+${additions} -${deletions}`;
}

function buildToolSummary(block: ToolCallBlock) {
  const lines = countLines(block.resultContent);

  if (block.status === 'running') {
    return 'running...';
  }

  if (block.status === 'error') {
    return block.summary ?? 'error';
  }

  if (block.resultKind === 'read') {
    return lines > 0 ? `read, ${lines} lines` : 'read';
  }

  if (block.resultKind === 'bash') {
    return lines > 0 ? `completed, ${lines} lines` : 'completed';
  }

  if (block.resultKind === 'write') {
    const diffStat = getDiffStat(block.resultContent);
    return diffStat ? `write, ${diffStat}` : 'write';
  }

  return block.summary ?? 'completed';
}

export function buildToolInputPreview(
  toolName: string,
  input: Record<string, unknown> | null,
  partialJson = '',
) {
  const filePath = getString(input?.file_path) ?? getString(input?.path);
  if (filePath) {
    return filePath;
  }

  const command = getString(input?.command) ?? getString(input?.cmd);
  if (command) {
    return command;
  }

  if (partialJson.trim()) {
    return partialJson.trim();
  }

  return toolName;
}

export function createTimelineItemFromRun(run: Run | RunSummary): ChatTimelineItem {
  return {
    id: run.id,
    conversationId: run.conversation_id,
    runId: run.id,
    taskId: run.task_id,
    assignmentId: run.assignment_id,
    agentId: run.agent_id,
    agentName: run.agent_id,
    agentSessionId: run.agent_session_id,
    prompt: run.prompt,
    status: run.status,
    startedAt: run.started_at,
    finishedAt: run.finished_at,
    eventCount: 'events' in run ? run.events.length : run.event_count,
    detailsLoaded: 'events' in run,
    blocks: [],
    error: run.error_message,
  };
}

function makeAgentTextBlock(runId: string): TimelineBlock {
  return {
    kind: 'agent_text',
    id: `${runId}-text-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    content: '',
  };
}

function makeToolBlock(event: ToolStartedEvent): ToolCallBlock {
  return {
    kind: 'tool_call',
    id: `${event.runId}-${event.toolUseId}`,
    toolUseId: event.toolUseId,
    toolName: event.toolName,
    status: 'running',
    inputPreview: event.toolName,
    input: null,
    partialJson: '',
    summary: null,
    resultContent: null,
    expanded: false,
    resultKind: getToolResultKind(event.toolName),
  };
}

function updateToolBlock(
  item: ChatTimelineItem,
  toolUseId: string,
  updater: (block: ToolCallBlock) => ToolCallBlock,
) {
  let found = false;
  const nextBlocks = item.blocks.map((block) => {
    if (block.kind !== 'tool_call' || block.toolUseId !== toolUseId) {
      return block;
    }
    found = true;
    return updater(block);
  });

  return { blocks: nextBlocks, found };
}

function appendAgentText(item: ChatTimelineItem, delta: string): ChatTimelineItem {
  const nextBlocks = [...item.blocks];
  const lastBlock = nextBlocks[nextBlocks.length - 1];
  if (lastBlock?.kind === 'agent_text') {
    lastBlock.content += delta;
    return { ...item, blocks: nextBlocks };
  }

  const newBlock = makeAgentTextBlock(item.runId);
  if (newBlock.kind === 'agent_text') {
    newBlock.content = delta;
  }
  nextBlocks.push(newBlock);
  return { ...item, blocks: nextBlocks };
}

function appendFileChangeIndicator(
  item: ChatTimelineItem,
  block: FileChangeIndicatorBlock,
): ChatTimelineItem {
  const exists = item.blocks.some(
    (candidate) =>
      candidate.kind === 'file_change_indicator' && candidate.id === block.id,
  );
  if (exists) {
    return item;
  }

  return {
    ...item,
    blocks: [...item.blocks, block],
  };
}

export function applySocketEventToTimelineItem(
  item: ChatTimelineItem,
  event: RuntimeSocketEvent,
): ChatTimelineItem {
  switch (event.type) {
    case 'text_delta':
      return appendAgentText(item, event.delta);
    case 'tool_started': {
      const existing = item.blocks.find(
        (block) => block.kind === 'tool_call' && block.toolUseId === event.toolUseId,
      );
      if (existing) {
        return item;
      }
      return {
        ...item,
        status: 'running',
        blocks: [...item.blocks, makeToolBlock(event)],
      };
    }
    case 'tool_input_delta': {
      const updated = updateToolBlock(item, event.toolUseId, (block) => ({
        ...block,
        partialJson: block.partialJson + event.partialJson,
        input: event.parsedInput ?? block.input,
        inputPreview: buildToolInputPreview(
          event.toolName,
          event.parsedInput ?? block.input,
          block.partialJson + event.partialJson,
        ),
        summary: buildToolSummary({
          ...block,
          partialJson: block.partialJson + event.partialJson,
          input: event.parsedInput ?? block.input,
        }),
      }));
      return updated.found ? { ...item, blocks: updated.blocks } : item;
    }
    case 'tool_completed': {
      const updated = updateToolBlock(item, event.toolUseId, (block) => ({
        ...block,
        status: block.status === 'error' ? 'error' : 'completed',
        input: event.input,
        inputPreview: buildToolInputPreview(event.toolName, event.input, block.partialJson),
        summary: buildToolSummary({
          ...block,
          status: block.status === 'error' ? 'error' : 'completed',
          input: event.input,
          inputPreview: buildToolInputPreview(event.toolName, event.input, block.partialJson),
        }),
      }));
      const withToolUpdate = updated.found ? { ...item, blocks: updated.blocks } : item;
      const filePath = getString(event.input.file_path) ?? getString(event.input.path);
      if (!isWriteToolName(event.toolName) || !filePath) {
        return withToolUpdate;
      }

      return appendFileChangeIndicator(withToolUpdate, {
        kind: 'file_change_indicator',
        id: `${event.runId}-${event.toolUseId}-file-change`,
        filePath,
        changeType:
          event.toolName === 'Write' || event.toolName === 'Create' ? 'create' : 'edit',
      });
    }
    case 'tool_result': {
      const updated = updateToolBlock(item, event.toolUseId, (block) => ({
        ...block,
        status: event.isError ? 'error' : 'completed',
        summary: buildToolSummary({
          ...block,
          status: event.isError ? 'error' : 'completed',
          resultContent: event.content ?? block.resultContent,
          summary: event.summary,
        }),
        resultContent: event.content ?? block.resultContent,
      }));
      return updated.found ? { ...item, blocks: updated.blocks } : item;
    }
    case 'tool_error': {
      const updated = updateToolBlock(item, event.toolUseId, (block) => ({
        ...block,
        status: 'error',
        summary: buildToolSummary({
          ...block,
          status: 'error',
          summary: event.error,
          resultContent: event.error,
        }),
        resultContent: event.error,
      }));
      return updated.found ? { ...item, blocks: updated.blocks } : item;
    }
    case 'approval_required':
      return {
        ...item,
        blocks: [
          ...item.blocks,
          {
            kind: 'approval_request',
            id: `${event.runId}-approval-${item.blocks.length}`,
            reason: event.reason,
            approvalId: event.approvalId ?? '',
            toolName: typeof event.rawEvent?.tool_name === 'string' ? event.rawEvent.tool_name : undefined,
            toolInput: event.rawEvent?.tool_input as Record<string, unknown> | undefined,
            status: 'pending' as const,
          },
        ],
      };
    case 'run_completed':
      return {
        ...item,
        status: 'completed',
        finishedAt: event.occurredAt ?? item.finishedAt ?? new Date().toISOString(),
      };
    case 'run_failed':
      return {
        ...item,
        status: 'failed',
        finishedAt: event.occurredAt ?? item.finishedAt ?? new Date().toISOString(),
        error: event.error,
      };
    case 'run_interrupted':
      return {
        ...item,
        status: 'interrupted',
        finishedAt: event.occurredAt ?? item.finishedAt ?? new Date().toISOString(),
        error: event.reason,
      };
    case 'command_started':
    case 'command_output':
    case 'file_changed':
      return item;
  }

  return item;
}

function toSocketEvent(
  run: Run,
  event: Run['events'][number],
): RuntimeSocketEvent | null {
  const payload = event.payload_json;
  const base = {
    eventId: event.event_id,
    occurredAt: event.occurred_at,
    seq: event.seq,
    runId: run.id,
    conversationId: run.conversation_id,
    agentId: typeof payload.agentId === 'string' ? payload.agentId : run.agent_id,
    taskId: typeof payload.taskId === 'string' ? payload.taskId : run.task_id,
  };

  switch (event.event_type) {
    case 'text_delta':
      return typeof payload.delta === 'string'
        ? { type: 'text_delta', ...base, delta: payload.delta }
        : null;
    case 'tool_started':
      return typeof payload.toolUseId === 'string' && typeof payload.toolName === 'string'
        ? {
            type: 'tool_started',
            ...base,
            toolUseId: payload.toolUseId,
            toolName: payload.toolName,
          }
        : null;
    case 'tool_input_delta':
      return typeof payload.toolUseId === 'string' &&
        typeof payload.toolName === 'string' &&
        typeof payload.partialJson === 'string'
        ? {
            type: 'tool_input_delta',
            ...base,
            toolUseId: payload.toolUseId,
            toolName: payload.toolName,
            partialJson: payload.partialJson,
            parsedInput: getRecord(payload.parsedInput) ?? undefined,
          }
        : null;
    case 'tool_completed':
      return typeof payload.toolUseId === 'string' &&
        typeof payload.toolName === 'string' &&
        getRecord(payload.input)
        ? {
            type: 'tool_completed',
            ...base,
            toolUseId: payload.toolUseId,
            toolName: payload.toolName,
            input: getRecord(payload.input)!,
          }
        : null;
    case 'tool_result':
      return typeof payload.toolUseId === 'string' &&
        typeof payload.toolName === 'string' &&
        typeof payload.summary === 'string'
        ? {
            type: 'tool_result',
            ...base,
            toolUseId: payload.toolUseId,
            toolName: payload.toolName,
            summary: payload.summary,
            content: getString(payload.content) ?? undefined,
            isError: payload.isError === true,
          }
        : null;
    case 'tool_error':
      return typeof payload.toolUseId === 'string' &&
        typeof payload.toolName === 'string' &&
        typeof payload.error === 'string'
        ? {
            type: 'tool_error',
            ...base,
            toolUseId: payload.toolUseId,
            toolName: payload.toolName,
            error: payload.error,
          }
        : null;
    case 'approval_required':
      return typeof payload.reason === 'string'
        ? {
            type: 'approval_required',
            ...base,
            reason: payload.reason,
          }
        : null;
    case 'run_completed':
      return typeof payload.finalText === 'string' && typeof payload.exitCode === 'number'
        ? {
            type: 'run_completed',
            ...base,
            finalText: payload.finalText,
            exitCode: payload.exitCode,
          }
        : null;
    case 'run_failed':
      return typeof payload.error === 'string'
        ? {
            type: 'run_failed',
            ...base,
            error: payload.error,
          }
        : null;
    case 'run_interrupted':
      return typeof payload.reason === 'string'
        ? {
            type: 'run_interrupted',
            ...base,
            reason: payload.reason,
          }
        : null;
    default:
      return null;
  }
}

export function applyRunDetail(run: Run): ChatTimelineItem {
  const item = run.events.reduce((timelineItem, event) => {
    const socketEvent = toSocketEvent(run, event);
    return socketEvent ? applySocketEventToTimelineItem(timelineItem, socketEvent) : timelineItem;
  }, createTimelineItemFromRun(run));
  return {
    ...item,
    eventCount: run.events.length,
    detailsLoaded: true,
  };
}
