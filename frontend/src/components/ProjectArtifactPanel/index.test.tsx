import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectArtifactPanel } from './index';
import { api } from '../../services/api';
import type { Workspace } from '../../types';

vi.mock('../../services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      getWorkspaceFileChanges: vi.fn(),
      startWorkspacePreview: vi.fn(),
      stopWorkspacePreview: vi.fn(),
      getWorkspaceDeployScripts: vi.fn(),
      startWorkspaceDeploy: vi.fn(),
      getWorkspaceDeploy: vi.fn(),
    },
  };
});

const workspace: Workspace = {
  id: 'ws-1',
  conversation_id: 'conv-1',
  root_path: '/tmp/project',
  mode: 'direct',
  created_at: '2026-06-20T00:00:00.000Z',
  updated_at: '2026-06-20T00:00:00.000Z',
};

describe('ProjectArtifactPanel', () => {
  beforeEach(() => {
    vi.mocked(api.getWorkspaceFileChanges).mockReset().mockResolvedValue({
      workspaceId: 'ws-1',
      baseRef: 'HEAD',
      files: [{
        filePath: 'src/App.tsx',
        changeType: 'edit',
        oldContent: 'before',
        newContent: 'after',
        confidence: 'exact',
        source: 'filesystem',
        additions: 1,
        deletions: 1,
        binary: false,
      }],
      summary: { files: 1, additions: 1, deletions: 1 },
    });
    vi.mocked(api.startWorkspacePreview).mockReset().mockResolvedValue({
      url: 'http://127.0.0.1:3100',
      port: 3100,
    });
    vi.mocked(api.getWorkspaceDeployScripts).mockReset().mockResolvedValue({
      workspaceId: 'ws-1',
      scripts: ['build'],
      defaultScript: 'build',
    });
    vi.mocked(api.getWorkspaceDeploy).mockReset().mockResolvedValue(null);
    vi.mocked(api.startWorkspaceDeploy).mockReset().mockResolvedValue({
      workspaceId: 'ws-1',
      status: 'running',
      script: 'build',
      command: 'npm run build',
      logs: [],
      exitCode: null,
      startedAt: '2026-06-20T00:00:00.000Z',
      finishedAt: null,
      errorMessage: null,
    });
  });

  it('loads the whole workspace diff relative to HEAD', async () => {
    render(
      <ProjectArtifactPanel open activeTab="diff" workspace={workspace} onClose={vi.fn()} />,
    );

    await waitFor(() => expect(api.getWorkspaceFileChanges).toHaveBeenCalledWith('ws-1'));
    expect(screen.getByText('整个项目')).toBeTruthy();
    expect(screen.getByText('当前工作区 vs HEAD')).toBeTruthy();
    expect(screen.getByText((_, element) => (
      element?.tagName === 'SPAN' && element.textContent?.includes('1 个文件') === true
    ))).toBeTruthy();
    expect(screen.getAllByText('src/App.tsx').length).toBeGreaterThan(0);
    expect(screen.getByText('+ after')).toBeTruthy();
  });

  it('starts preview for the workspace', async () => {
    render(
      <ProjectArtifactPanel open activeTab="preview" workspace={workspace} onClose={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole('button', { name: '启动预览' }));
    await waitFor(() => expect(api.startWorkspacePreview).toHaveBeenCalledWith('ws-1'));
    expect(screen.getByText('http://127.0.0.1:3100')).toBeTruthy();
  });

  it('starts deployment for the workspace', async () => {
    render(
      <ProjectArtifactPanel open activeTab="deploy" workspace={workspace} onClose={vi.fn()} />,
    );

    fireEvent.click(await screen.findByRole('button', { name: '部署' }));
    await waitFor(() => {
      expect(api.startWorkspaceDeploy).toHaveBeenCalledWith('ws-1', 'build');
    });
    expect(screen.getByText('npm run build')).toBeTruthy();
  });
});
