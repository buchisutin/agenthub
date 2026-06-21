import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './api';

describe('workspace artifact API client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls workspace-scoped artifact endpoints', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    vi.stubGlobal('fetch', fetchMock);

    await api.getWorkspaceFileChanges('ws-1');
    await api.startWorkspacePreview('ws-1');
    await api.stopWorkspacePreview('ws-1');
    await api.getWorkspaceDeployScripts('ws-1');
    await api.startWorkspaceDeploy('ws-1', 'build');
    await api.getWorkspaceDeploy('ws-1');

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'http://localhost:8000/workspaces/ws-1/file-changes',
      'http://localhost:8000/workspaces/ws-1/preview/start',
      'http://localhost:8000/workspaces/ws-1/preview/stop',
      'http://localhost:8000/workspaces/ws-1/deploy/scripts',
      'http://localhost:8000/workspaces/ws-1/deploy/start',
      'http://localhost:8000/workspaces/ws-1/deploy',
    ]);
    expect(fetchMock.mock.calls[4]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ script: 'build' }),
    });
  });
});
