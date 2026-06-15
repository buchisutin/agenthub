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
      getRunCardSummary: vi.fn().mockResolvedValue({
        workspace: {
          mode: 'git_clone',
          rootPath: '/tmp/.agenthub/run-1',
          branchName: 'agenthub/run-1',
          status: 'ready',
          errorMessage: null,
        },
        changeApplication: null,
        fileChanges: [
          {
            filePath: 'src/App.tsx',
            changeType: 'edit',
            oldContent: 'before',
            newContent: 'after',
            confidence: 'exact',
            source: 'tool_event',
          },
        ],
        mergeMode: 'manual',
        mergeStatus: null,
        merge: null,
      }),
      getRunDeployScripts: vi.fn().mockResolvedValue({
        runId: 'run-1',
        scripts: ['start', 'build'],
        defaultScript: 'start',
      }),
      getRunDeploy: vi.fn().mockResolvedValue(null),
      checkRunApply: vi.fn().mockResolvedValue({
        runId: 'run-1',
        canApply: true,
        files: [{ filePath: 'src/App.tsx', changeType: 'edit', status: 'safe' }],
        summary: { safe: 1, conflict: 0, skipped: 0 },
      }),
      requestApplyChanges: vi.fn().mockResolvedValue({
        id: 'approval-1',
        conversationId: 'conv-1',
        runId: 'run-1',
        taskId: null,
        assignmentId: null,
        actionType: 'apply_changes',
        status: 'pending',
        title: 'Apply Changes',
        description: null,
        payload: { runId: 'run-1' },
        result: null,
        errorMessage: null,
        createdAt: '2026-06-13T00:00:00.000Z',
        decidedAt: null,
        executedAt: null,
      }),
      startRunDeploy: vi.fn().mockResolvedValue({
        runId: 'run-1',
        status: 'running',
        script: 'start',
        command: 'npm run start',
        logs: [],
        exitCode: null,
        startedAt: '2026-06-13T00:00:00.000Z',
        finishedAt: null,
        errorMessage: null,
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

    expect(screen.queryByText('成果面板')).toBeNull();
    expect(screen.getByRole('button', { name: '代码改动' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '网页预览' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '执行计划' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Summary' })).toBeNull();
    expect(screen.getByText('执行计划')).toBeTruthy();
    expect(screen.getByText('Frontend UI')).toBeTruthy();
    expect(screen.getByText('frontend-agent')).toBeTruthy();
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

  it('renders a sticky action footer and requests apply from the panel', async () => {
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
      expect(screen.getByText('1 files modified')).toBeTruthy();
      expect(screen.getByText('npm run start ready')).toBeTruthy();
    });

    const footer = screen.getByText('1 files modified').closest('div')?.parentElement?.parentElement;
    expect(footer?.getAttribute('class')).toContain('bg-white/95');
    expect(screen.getByRole('button', { name: 'Apply Changes' }).getAttribute('class')).toContain('bg-[#2563EB]');

    fireEvent.click(screen.getByRole('button', { name: 'Apply Changes' }));

    await waitFor(() => {
      expect(api.checkRunApply).toHaveBeenCalledWith('run-1');
      expect(api.requestApplyChanges).toHaveBeenCalledWith('run-1');
    });
  });

  it('renders deploy logs as a bottom console drawer above the footer', async () => {
    vi.mocked(api.getRunDeploy).mockResolvedValueOnce({
      runId: 'run-1',
      status: 'running',
      script: 'start',
      command: 'npm run start',
      logs: [{ stream: 'stdout', chunk: 'listening on 5173\n', at: '2026-06-13T00:00:00.000Z' }],
      exitCode: null,
      startedAt: '2026-06-13T00:00:00.000Z',
      finishedAt: null,
      errorMessage: null,
    });

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

    const terminal = await screen.findByText('listening on 5173');
    const pre = terminal.closest('pre');
    expect(pre?.getAttribute('class')).toContain('rounded-t-xl');
    expect(pre?.getAttribute('class')).toContain('bg-[#1A1A1A]');
    expect(pre?.parentElement?.getAttribute('class')).toContain('flex-col');
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
    expect(resizeHandle.getAttribute('class')).toContain('bg-transparent');
    expect(resizeHandle.querySelector('span')?.getAttribute('class')).toContain('w-px');

    fireEvent.mouseDown(resizeHandle, { clientX: 900 });
    fireEvent.mouseMove(window, { clientX: 820 });
    fireEvent.mouseUp(window);

    expect(panel.style.width).toBe('500px');

    fireEvent.doubleClick(resizeHandle);

    expect(panel.style.width).toBe('420px');
  });
});
