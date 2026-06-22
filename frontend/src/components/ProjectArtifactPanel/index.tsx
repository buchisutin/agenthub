import { useEffect, useRef, useState } from 'react';
import { api } from '../../services/api';
import type {
  PreviewStartResponse,
  ProjectFileChange,
  Workspace,
  WorkspaceDeployRecord,
  WorkspaceDeployScriptsResponse,
  WorkspaceDiffResponse,
} from '../../types';
import { FileDiffBlock } from '../DiffCard';

export type ProjectArtifactTab = 'diff' | 'preview' | 'deploy';

interface ProjectArtifactPanelProps {
  open: boolean;
  activeTab: ProjectArtifactTab;
  workspace: Workspace;
  revision?: number;
  onClose: () => void;
}

export function ProjectArtifactPanel({
  open,
  activeTab,
  workspace,
  revision = 0,
  onClose,
}: ProjectArtifactPanelProps) {
  if (!open) return null;
  const title = activeTab === 'diff' ? '代码改动' : activeTab === 'preview' ? '网页预览' : '部署';

  return (
    <aside
      aria-label="项目成果"
      className="absolute inset-y-0 right-0 z-20 flex w-[620px] max-w-[80vw] flex-col overflow-hidden bg-white"
      style={{ borderLeft: '0.5px solid var(--app-border)', boxShadow: '-4px 0 16px rgba(0,0,0,0.05)' }}
    >
      <header
        className="flex items-start justify-between gap-4 px-5 py-4"
        style={{ borderBottom: '0.5px solid var(--app-border)' }}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-[var(--app-text)]">{title}</span>
            <span className="rounded-md bg-[#F0F5F0] px-2 py-0.5 text-[11px] text-[#2E6B4F]">整个项目</span>
          </div>
          <div className="mt-1 truncate text-xs text-[var(--app-text-secondary)]" title={workspace.root_path}>
            {workspace.root_path}
          </div>
        </div>
        <button type="button" onClick={onClose} className="text-xs text-[var(--app-text-secondary)]">
          Close
        </button>
      </header>
      <div className="flex-1 overflow-y-auto p-5">
        {activeTab === 'diff' && <ProjectDiffView workspaceId={workspace.id} revision={revision} />}
        {activeTab === 'preview' && <ProjectPreviewView workspaceId={workspace.id} />}
        {activeTab === 'deploy' && <ProjectDeployView workspaceId={workspace.id} />}
      </div>
    </aside>
  );
}

function ProjectDiffView({ workspaceId, revision }: { workspaceId: string; revision: number }) {
  const requestKey = `${workspaceId}:${revision}`;
  const [result, setResult] = useState<{
    requestKey: string;
    data: WorkspaceDiffResponse | null;
    error: string | null;
  }>({ requestKey: '', data: null, error: null });
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.getWorkspaceFileChanges(workspaceId)
      .then((next) => {
        if (cancelled) return;
        setResult({ requestKey, data: next, error: null });
        setSelectedPath((current) =>
          current && next.files.some((file) => file.filePath === current)
            ? current
            : next.files[0]?.filePath ?? null,
        );
      })
      .catch((nextError: unknown) => {
        if (!cancelled) {
          setResult({
            requestKey,
            data: null,
            error: nextError instanceof Error ? nextError.message : '加载项目 Diff 失败',
          });
        }
      });
    return () => { cancelled = true; };
  }, [requestKey, workspaceId]);

  if (result.requestKey !== requestKey) return <PanelMessage text="正在加载项目 Diff..." />;
  if (result.error) return <PanelMessage text={result.error} danger />;
  const data = result.data;
  if (!data || data.files.length === 0) return <PanelMessage text="当前项目没有未提交的代码改动" />;

  const selected = data.files.find((file) => file.filePath === selectedPath) ?? data.files[0];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 rounded-lg bg-[var(--card-subtle)] px-3 py-2 text-xs">
        <span className="text-[var(--app-text-secondary)]">当前工作区 vs HEAD</span>
        <span className="text-[var(--app-text-secondary)]">
          {data.summary.files} 个文件 · <span className="text-green-700">+{data.summary.additions}</span>{' '}
          <span className="text-red-700">-{data.summary.deletions}</span>
        </span>
      </div>
      <div className="grid min-h-[360px] grid-cols-[220px_minmax(0,1fr)] gap-3">
        <div className="overflow-hidden rounded-lg" style={{ border: '0.5px solid var(--app-border)' }}>
          {data.files.map((file) => (
            <FileButton
              key={file.filePath}
              file={file}
              selected={file.filePath === selected?.filePath}
              onClick={() => setSelectedPath(file.filePath)}
            />
          ))}
        </div>
        <div className="min-w-0">
          {selected?.binary ? (
            <PanelMessage text={`${selected.filePath} 是二进制文件`} />
          ) : selected ? (
            <FileDiffBlock change={selected} workspaceRootPath={null} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function FileButton({ file, selected, onClick }: { file: ProjectFileChange; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs"
      style={{ backgroundColor: selected ? '#F0F5F0' : '#FFFFFF', borderBottom: '0.5px solid var(--app-border)' }}
    >
      <span className="min-w-0 truncate text-[var(--app-text)]">{file.filePath}</span>
      <span className="shrink-0 text-[10px] text-[var(--app-text-secondary)]">+{file.additions} -{file.deletions}</span>
    </button>
  );
}

function ProjectPreviewView({ workspaceId }: { workspaceId: string }) {
  const [preview, setPreview] = useState<PreviewStartResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startPreview() {
    setLoading(true);
    setError(null);
    try {
      setPreview(await api.startWorkspacePreview(workspaceId));
    } catch (nextError: unknown) {
      setError(nextError instanceof Error ? nextError.message : '启动预览失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <button type="button" onClick={() => void startPreview()} disabled={loading} className="rounded-lg bg-[#F0F5F0] px-3 py-2 text-sm text-[#2E6B4F]">
        {loading ? '启动中...' : '启动预览'}
      </button>
      {preview && (
        <>
          <div className="rounded-lg bg-[var(--card-subtle)] px-3 py-2 text-xs text-[var(--app-text-secondary)]">{preview.url}</div>
          <iframe title="Project preview" src={preview.url} className="h-[480px] w-full rounded-lg bg-white" style={{ border: '0.5px solid var(--app-border)' }} />
        </>
      )}
      {error && <PanelMessage text={error} danger />}
    </div>
  );
}

function ScriptDropdown({ scripts, value, onChange }: { scripts: string[]; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm"
        style={{ border: '0.5px solid var(--app-border)', background: 'var(--card-bg)', color: 'var(--app-text)' }}
      >
        <span>{value || '选择脚本'}</span>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ opacity: 0.5 }}>
          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div
          className="absolute left-0 top-full z-50 mt-1 min-w-full rounded-lg py-1 shadow-lg"
          style={{ background: 'var(--card-bg)', border: '0.5px solid var(--app-border)' }}
        >
          {scripts.map((script) => (
            <button
              key={script}
              type="button"
              onClick={() => { onChange(script); setOpen(false); }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--card-subtle)]"
              style={{ color: 'var(--app-text)' }}
            >
              {script === value && (
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
              <span style={{ paddingLeft: script === value ? 0 : 20 }}>{script}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ProjectDeployView({ workspaceId }: { workspaceId: string }) {
  const [scripts, setScripts] = useState<WorkspaceDeployScriptsResponse | null>(null);
  const [selectedScript, setSelectedScript] = useState('');
  const [deploy, setDeploy] = useState<WorkspaceDeployRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.getWorkspaceDeployScripts(workspaceId),
      api.getWorkspaceDeploy(workspaceId),
    ]).then(([nextScripts, nextDeploy]) => {
      if (cancelled) return;
      setScripts(nextScripts);
      setSelectedScript(nextScripts.defaultScript ?? nextScripts.scripts[0] ?? '');
      setDeploy(nextDeploy);
    }).catch((nextError: unknown) => {
      if (!cancelled) setError(nextError instanceof Error ? nextError.message : '加载部署配置失败');
    });
    return () => { cancelled = true; };
  }, [workspaceId]);

  async function startDeploy() {
    if (!selectedScript) return;
    setError(null);
    try {
      setDeploy(await api.startWorkspaceDeploy(workspaceId, selectedScript));
    } catch (nextError: unknown) {
      setError(nextError instanceof Error ? nextError.message : '启动部署失败');
    }
  }

  return (
    <div className="space-y-3">
      {scripts && scripts.scripts.length > 0 ? (
        <div className="flex items-center gap-2">
          <ScriptDropdown scripts={scripts.scripts} value={selectedScript} onChange={setSelectedScript} />
          <button type="button" onClick={() => void startDeploy()} className="rounded-lg bg-[#2E6B4F] px-4 py-2 text-sm text-white">部署</button>
        </div>
      ) : (
        <PanelMessage text="当前项目没有可用的部署脚本" />
      )}
      {deploy && (
        <div className="space-y-2 rounded-lg bg-[#1A1A1A] p-3 font-mono text-xs text-gray-200">
          <div>{deploy.command}</div>
          {deploy.logs.map((entry, index) => <div key={`${entry.at}-${index}`}>{entry.chunk}</div>)}
        </div>
      )}
      {error && <PanelMessage text={error} danger />}
    </div>
  );
}

function PanelMessage({ text, danger = false }: { text: string; danger?: boolean }) {
  return (
    <div className="rounded-lg px-3 py-3 text-sm" style={{ backgroundColor: danger ? '#FEF2F2' : 'var(--card-subtle)', color: danger ? 'var(--status-danger)' : 'var(--app-text-secondary)' }}>
      {text}
    </div>
  );
}
