import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DeployCard } from './index';
import { api } from '../../services/api';

vi.mock('../../services/api', () => ({
  api: {
    getRunDeployScripts: vi.fn(),
    startRunDeploy: vi.fn(),
    getRunDeploy: vi.fn(),
  },
}));

const mockedGetScripts = vi.mocked(api.getRunDeployScripts);
const mockedStartDeploy = vi.mocked(api.startRunDeploy);
const mockedGetDeploy = vi.mocked(api.getRunDeploy);

describe('DeployCard', () => {
  beforeEach(() => {
    mockedGetScripts.mockReset();
    mockedStartDeploy.mockReset();
    mockedGetDeploy.mockReset();
    mockedGetScripts.mockResolvedValue({
      runId: 'run-1',
      scripts: ['dev', 'build', 'start'],
      defaultScript: 'build',
    });
    mockedStartDeploy.mockResolvedValue({
      runId: 'run-1',
      status: 'running',
      script: 'build',
      command: 'npm run build',
      logs: [],
      exitCode: null,
      startedAt: '2026-06-15T00:00:00.000Z',
      finishedAt: null,
      errorMessage: null,
    });
    mockedGetDeploy.mockResolvedValue({
      runId: 'run-1',
      status: 'succeeded',
      script: 'build',
      command: 'npm run build',
      logs: [{ stream: 'stdout', chunk: 'vite build\n', at: '2026-06-15T00:00:01.000Z' }],
      exitCode: 0,
      startedAt: '2026-06-15T00:00:00.000Z',
      finishedAt: '2026-06-15T00:00:01.000Z',
      errorMessage: null,
    });
  });

  it('loads scripts and runs the default build deploy', async () => {
    render(<DeployCard runId="run-1" />);

    expect(await screen.findByText('Detected script:')).toBeTruthy();
    expect(screen.getByText('npm run build')).toBeTruthy();
    expect(screen.queryByText('Deploy logs will appear here.')).toBeNull();
    expect(screen.queryByText('Starting process...')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Run Deploy' }));

    await waitFor(() => expect(mockedStartDeploy).toHaveBeenCalledWith('run-1', 'build'));
    expect(await screen.findByText('Deploy succeeded')).toBeTruthy();
    expect(screen.getByText('vite build')).toBeTruthy();
  });

  it('keeps build selected for deploy when build is available', async () => {
    render(<DeployCard runId="run-1" />);

    await screen.findByText('npm run build');
    fireEvent.click(screen.getByRole('button', { name: 'Run Deploy' }));

    await waitFor(() => expect(mockedStartDeploy).toHaveBeenCalledWith('run-1', 'build'));
  });

  it('shows a progressive starting terminal only after the run is requested', async () => {
    mockedStartDeploy.mockImplementation(() => new Promise(() => undefined));

    render(<DeployCard runId="run-1" />);

    await screen.findByText('npm run build');
    expect(screen.queryByText('Starting process...')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Run Deploy' }));

    expect(await screen.findByText('Starting process...')).toBeTruthy();
  });
});
