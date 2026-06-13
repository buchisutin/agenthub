function normalizePath(value: string | null | undefined): string {
  return (value ?? '').replace(/\\/g, '/');
}

export function formatRelativePath(filePath: string, rootPath?: string | null): string {
  const normalizedFilePath = normalizePath(filePath).replace(/^file:\/\//, '');
  if (!normalizedFilePath) {
    return filePath;
  }

  const normalizedRootPath = normalizePath(rootPath);
  if (normalizedRootPath && normalizedFilePath.startsWith(normalizedRootPath)) {
    const trimmed = normalizedFilePath.slice(normalizedRootPath.length).replace(/^\/+/, '');
    if (trimmed) {
      return trimmed;
    }
  }

  const agenthubIndex = normalizedFilePath.lastIndexOf('/.agenthub/');
  if (agenthubIndex >= 0) {
    const trimmed = normalizedFilePath.slice(agenthubIndex + '/.agenthub/'.length);
    if (trimmed) {
      return trimmed;
    }
  }

  return normalizedFilePath.replace(/^\/+/, '');
}
