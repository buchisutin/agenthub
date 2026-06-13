import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PreviewCard } from './index';
import { api } from '../../services/api';

vi.mock('../../services/api', () => ({
  api: {
    stopRunPreview: vi.fn(),
  },
}));

const mockedStopRunPreview = vi.mocked(api.stopRunPreview);

describe('PreviewCard', () => {
  beforeEach(() => {
    mockedStopRunPreview.mockReset();
    mockedStopRunPreview.mockResolvedValue({ ok: true });
  });

  it('renders local iframe preview for 127.0.0.1 url', () => {
    render(
      <PreviewCard
        runId="run-1"
        initialUrl="http://127.0.0.1:3100"
        initialPort={3100}
      />,
    );

    const iframe = screen.getByTitle('preview-run-1') as HTMLIFrameElement;
    expect(iframe.getAttribute('src')).toBe('http://127.0.0.1:3100');
  });

  it('stops preview and notifies parent on success', async () => {
    const onStop = vi.fn();
    render(
      <PreviewCard
        runId="run-2"
        initialUrl="http://127.0.0.1:3101"
        initialPort={3101}
        onStop={onStop}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));

    await waitFor(() => expect(mockedStopRunPreview).toHaveBeenCalledWith('run-2'));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('shows stop error when stop preview fails', async () => {
    mockedStopRunPreview.mockRejectedValueOnce(new Error('stop failed'));

    render(
      <PreviewCard
        runId="run-3"
        initialUrl="http://127.0.0.1:3102"
        initialPort={3102}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));

    expect(await screen.findByText('stop failed')).toBeTruthy();
  });

  it('rejects non-127.0.0.1 iframe sources', () => {
    render(
      <PreviewCard
        runId="run-4"
        initialUrl="http://localhost:3103"
        initialPort={3103}
      />,
    );

    expect(screen.queryByTitle('preview-run-4')).toBeNull();
    expect(screen.getByText('Invalid preview URL. Only 127.0.0.1 local addresses are supported.')).toBeTruthy();
  });

  it('shows resize handle for preview iframe', () => {
    render(
      <PreviewCard
        runId="run-5"
        initialUrl="http://127.0.0.1:3104"
        initialPort={3104}
      />,
    );

    const handle = screen.getByRole('separator');
    expect(handle).toBeTruthy();
    expect(handle.getAttribute('aria-label')).toBe('Resize preview height');
  });
});
