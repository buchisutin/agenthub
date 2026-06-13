import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ArtifactPanel } from './index';
import { api } from '../../services/api';
import type { Agent, ChatTimelineItem, PlanCardModel } from '../../types';

vi.mock('../../services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      getRunFileChanges: vi.fn().mockResolvedValue([
        {
          filePath: 'src/App.tsx',
          changeType: 'edit',
          oldContent: 'before',
          newContent: 'after',
          confidence: 'exact',
          source: 'tool_event',
        },
      ]),
      startRunPreview: vi.fn().mockResolvedValue({
        runId: 'run-1',
        port: 5174,
        url: 'http://127.0.0.1:5174',
        status: 'running',
      }),
    },
  };
});

const agent: Agent = {
  id: 'agent-1',
  name: 'frontend-agent',
  slug: 'frontend-agent',
  platform: 'claude',
  adapter_type: 'claude_cli',
  instructions: null,
  status: 'active',
  capabilities: null,
  config_json: null,
  enabled: true,
  is_default: true,
  created_at: '2026-06-13T00:00:00.000Z',
  updated_at: '2026-06-13T00:00:00.000Z',
};

const plan: PlanCardModel = {
  id: 'plan-1',
  conversationId: 'conv-1',
  prompt: 'build ui',
  summary: 'Build UI',
  createdAt: '2026-06-13T00:00:00.000Z',
  items: [
    {
      index: 1,
      plannerTaskId: 't1',
      title: 'Frontend UI',
      description: 'Build UI',
      assignedAgentId: 'agent-1',
      assignedAgentName: 'frontend-agent',
      taskId: 'task-1',
      assignmentId: 'assignment-1',
      runId: 'run-1',
      status: 'completed',
      dependsOn: [],
    },
  ],
};

const run: ChatTimelineItem = {
  id: 'run-1',
  conversationId: 'conv-1',
  runId: 'run-1',
  taskId: 'task-1',
  agentId: 'agent-1',
  agentName: 'frontend-agent',
  agentSessionId: null,
  prompt: 'Build UI',
  status: 'completed',
  startedAt: '2026-06-13T00:00:00.000Z',
  finishedAt: '2026-06-13T00:01:00.000Z',
  blocks: [],
  error: null,
};

describe('ArtifactPanel', () => {
  it('renders an understandable execution plan tab', () => {
    render(
      <ArtifactPanel
        open
        activeTab="tasks"
        plans={[plan]}
        timeline={[run]}
        agents={[agent]}
        onClose={() => {}}
        onTabChange={() => {}}
        onOpenTask={() => {}}
      />,
    );

    expect(screen.getByText('成果面板')).toBeTruthy();
    expect(screen.getByRole('button', { name: '代码改动' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '网页预览' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '执行计划' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Summary' })).toBeNull();
    expect(screen.getByText('执行计划')).toBeTruthy();
    expect(screen.getByText('任务')).toBeTruthy();
    expect(screen.getByText('负责 Agent')).toBeTruthy();
    expect(screen.getByText('状态')).toBeTruthy();
    expect(screen.getByText('Frontend UI')).toBeTruthy();
    expect(screen.getByText('@frontend-agent')).toBeTruthy();
  });

  it('loads code changes when the code changes tab is active', async () => {
    render(
      <ArtifactPanel
        open
        activeTab="diff"
        selectedRunId="run-1"
        plans={[plan]}
        timeline={[run]}
        agents={[agent]}
        onClose={() => {}}
        onTabChange={() => {}}
        onOpenTask={() => {}}
      />,
    );

    await waitFor(() => {
      expect(api.getRunFileChanges).toHaveBeenCalledWith('run-1');
      expect(screen.getByText('src/App.tsx')).toBeTruthy();
      expect(screen.getByText('- before')).toBeTruthy();
      expect(screen.getByText('+ after')).toBeTruthy();
      expect(screen.getByText('代码改动')).toBeTruthy();
    });
  });

  it('starts preview from the Preview tab', async () => {
    render(
      <ArtifactPanel
        open
        activeTab="preview"
        selectedRunId="run-1"
        plans={[plan]}
        timeline={[run]}
        agents={[agent]}
        onClose={() => {}}
        onTabChange={() => {}}
        onOpenTask={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '启动预览' }));

    await waitFor(() => {
      expect(api.startRunPreview).toHaveBeenCalledWith('run-1');
      expect(screen.getByText('http://127.0.0.1:5174')).toBeTruthy();
    });
  });

  it('lets users drag the panel wider and reset it by double click', () => {
    render(
      <ArtifactPanel
        open
        activeTab="tasks"
        plans={[plan]}
        timeline={[run]}
        agents={[agent]}
        onClose={() => {}}
        onTabChange={() => {}}
        onOpenTask={() => {}}
      />,
    );

    const panel = screen.getByLabelText('成果面板');
    const resizeHandle = screen.getByLabelText('调整成果面板宽度');

    expect(panel.style.width).toBe('420px');

    fireEvent.mouseDown(resizeHandle, { clientX: 900 });
    fireEvent.mouseMove(window, { clientX: 820 });
    fireEvent.mouseUp(window);

    expect(panel.style.width).toBe('500px');

    fireEvent.doubleClick(resizeHandle);

    expect(panel.style.width).toBe('420px');
  });
});
