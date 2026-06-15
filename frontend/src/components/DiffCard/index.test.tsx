import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DiffCard } from './index';
import { api } from '../../services/api';
import type { FileChange } from '../../types';

vi.mock('../../services/api', () => ({
  api: {
    getRunFileChanges: vi.fn(),
  },
}));

const mockedGetRunFileChanges = vi.mocked(api.getRunFileChanges);

function buildChange(overrides: Partial<FileChange> & Pick<FileChange, 'filePath'>): FileChange {
  return {
    filePath: overrides.filePath,
    changeType: overrides.changeType ?? 'edit',
    oldContent: overrides.oldContent ?? 'before\n',
    newContent: overrides.newContent ?? 'after\n',
    confidence: overrides.confidence ?? 'exact',
    source: overrides.source ?? 'tool_event',
  };
}

describe('DiffCard', () => {
  beforeEach(() => {
    mockedGetRunFileChanges.mockReset();
  });

  it('auto-expands all files when there are three or fewer changes', async () => {
    mockedGetRunFileChanges.mockResolvedValue([
      buildChange({ filePath: 'src/a.ts', changeType: 'create', oldContent: '', newContent: 'a\n' }),
      buildChange({ filePath: 'src/b.ts' }),
    ]);

    render(<DiffCard runId="run-1" />);

    await waitFor(() => expect(mockedGetRunFileChanges).toHaveBeenCalledWith('run-1'));
    expect(screen.getByText('Added (1)')).toBeTruthy();
    expect(screen.getByText('Modified (1)')).toBeTruthy();
    expect(screen.queryByText('Deleted (0)')).toBeNull();
    expect(screen.getByText('Code Review')).toBeTruthy();
    expect(screen.queryByText('Unified Diff')).toBeNull();
    expect(screen.getByText('- before')).toBeTruthy();
    expect(screen.getByText('+ after')).toBeTruthy();
    expect(screen.getByText('+ a')).toBeTruthy();
    expect(screen.queryByText('Before')).toBeNull();
    expect(screen.queryByText('After')).toBeNull();
  });

  it('shows empty state when no file changes are returned', async () => {
    mockedGetRunFileChanges.mockResolvedValue([]);

    render(<DiffCard runId="run-2" />);

    expect(await screen.findByText('No file changes detected in this run')).toBeTruthy();
  });

  it('shows best_effort warning when any change is inferred', async () => {
    mockedGetRunFileChanges.mockResolvedValue([
      buildChange({
        filePath: 'src/best.ts',
        oldContent: '',
        newContent: 'best effort\n',
        confidence: 'best_effort',
        source: 'filesystem',
      }),
    ]);

    render(<DiffCard runId="run-3" />);

    expect(await screen.findByText('This diff is inferred from available events and may be incomplete')).toBeTruthy();
  });

  it('keeps file diffs collapsed by default when there are more than three changes', async () => {
    mockedGetRunFileChanges.mockResolvedValue([
      buildChange({ filePath: 'src/one.ts', changeType: 'create', oldContent: '', newContent: 'one\n' }),
      buildChange({ filePath: 'src/two.ts' }),
      buildChange({ filePath: 'src/three.ts', changeType: 'delete', oldContent: 'three\n', newContent: '' }),
      buildChange({ filePath: 'src/four.ts' }),
    ]);

    render(<DiffCard runId="run-4" />);

    await screen.findByText('src/four.ts');
    expect(screen.queryByText('- before')).toBeNull();
    expect(screen.queryByText('+ after')).toBeNull();
    expect(screen.getByText('Added (1)')).toBeTruthy();
    expect(screen.getByText('Modified (2)')).toBeTruthy();
    expect(screen.getByText('Deleted (1)')).toBeTruthy();
  });

  it('expands only the clicked file when diffs start collapsed', async () => {
    mockedGetRunFileChanges.mockResolvedValue([
      buildChange({ filePath: 'src/first.ts', changeType: 'create', oldContent: '', newContent: 'first\n' }),
      buildChange({ filePath: 'src/second.ts' }),
      buildChange({ filePath: 'src/third.ts' }),
      buildChange({ filePath: 'src/fourth.ts' }),
    ]);

    render(<DiffCard runId="run-5" />);

    const secondButton = await screen.findByRole('button', { name: /src\/second\.ts/i });
    fireEvent.click(secondButton);

    expect(screen.getByText('- before')).toBeTruthy();
    expect(screen.getByText('+ after')).toBeTruthy();
  });

  it('keeps unchanged shifted lines as context when a line is inserted', async () => {
    mockedGetRunFileChanges.mockResolvedValue([
      buildChange({
        filePath: 'src/insert.ts',
        oldContent: 'const a = 1;\nreturn a;\n',
        newContent: 'const a = 1;\nconst b = 2;\nreturn a;\n',
      }),
    ]);

    render(<DiffCard runId="run-insert" />);

    expect(await screen.findByText('+ const b = 2;')).toBeTruthy();
    expect(screen.queryByText('- return a;')).toBeNull();
  });

  it('renders diff rows as full-width editor-style rows with separated line numbers', async () => {
    mockedGetRunFileChanges.mockResolvedValue([
      buildChange({
        filePath: 'src/layout.ts',
        oldContent: 'const value = 1;\n',
        newContent: 'const value = 2;\n',
      }),
    ]);

    render(<DiffCard runId="run-layout" />);

    expect(await screen.findByText('src/layout.ts')).toBeTruthy();
    const rows = document.querySelectorAll<HTMLElement>('.diff-row');
    expect(rows.length).toBeGreaterThan(0);
    expect(getComputedStyle(rows[0]).display).toBe('flex');
    expect(rows[0].style.width).toBe('100%');

    const deletedRow = Array.from(rows).find((row) => row.textContent?.includes('- const value = 1;'));
    const addedRow = Array.from(rows).find((row) => row.textContent?.includes('+ const value = 2;'));
    expect(deletedRow?.style.backgroundColor).toBe('rgb(255, 235, 233)');
    expect(addedRow?.style.backgroundColor).toBe('rgb(230, 255, 236)');

    const lineNumber = rows[0].querySelector<HTMLElement>('.diff-line-number');
    const codeCell = rows[0].querySelector<HTMLElement>('.diff-code-cell');
    expect(lineNumber?.style.userSelect).toBe('none');
    expect(lineNumber?.style.borderRight).toContain('solid');
    expect(codeCell?.style.whiteSpace).toBe('pre');
  });

  it('gates large diffs behind an explicit load action', async () => {
    mockedGetRunFileChanges.mockResolvedValue([
      buildChange({
        filePath: 'src/huge.ts',
        oldContent: '',
        newContent: Array.from({ length: 501 }, (_, index) => `line ${index + 1}`).join('\n'),
      }),
    ]);

    render(<DiffCard runId="run-6" />);

    expect(await screen.findByText('Large diff, click to load')).toBeTruthy();
    expect(screen.queryByText('+ line 1')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /load diff for src\/huge\.ts/i }));

    expect(await screen.findByText('+ line 1')).toBeTruthy();
    expect(screen.queryByText('Large diff, click to load')).toBeNull();
  });

  it('shows conflict and skipped labels per file from applyCheck after grouping', async () => {
    mockedGetRunFileChanges.mockResolvedValue([
      buildChange({ filePath: 'src/safe.ts', changeType: 'create', oldContent: '', newContent: 'safe\n' }),
      buildChange({ filePath: 'src/conflict.ts' }),
      buildChange({ filePath: 'src/skipped.ts', changeType: 'delete', oldContent: 'del\n', newContent: '' }),
      buildChange({ filePath: 'src/other.ts' }),
    ]);

    render(
      <DiffCard
        runId="run-7"
        applyCheck={{
          runId: 'run-7',
          canApply: false,
          files: [
            { filePath: 'src/safe.ts', changeType: 'create', status: 'safe' },
            { filePath: 'src/conflict.ts', changeType: 'edit', status: 'conflict', reason: 'Base file changed since run' },
            { filePath: 'src/skipped.ts', changeType: 'delete', status: 'skipped', reason: 'Delete not supported' },
          ],
          summary: { safe: 1, conflict: 1, skipped: 1 },
        }}
      />,
    );

    const conflictRow = (await screen.findByText('src/conflict.ts')).closest('button');
    const skippedRow = screen.getByText('src/skipped.ts').closest('button');
    const safeRow = screen.getByText('src/safe.ts').closest('button');

    expect(safeRow).toBeTruthy();
    expect(conflictRow).toBeTruthy();
    expect(skippedRow).toBeTruthy();

    expect(within(safeRow as HTMLElement).getAllByText('safe').length).toBeGreaterThanOrEqual(1);
    expect(within(conflictRow as HTMLElement).getByText(/conflict: Base file changed since run/)).toBeTruthy();
    expect(within(skippedRow as HTMLElement).getByText(/skipped: Delete not supported/)).toBeTruthy();
  });
});
