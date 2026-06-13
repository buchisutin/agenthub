function isTableLine(line: string) {
  return line.trim().startsWith('|');
}

function isSeparatorLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|')) return false;
  return trimmed
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean)
    .every((part) => /^:?-{3,}:?$/.test(part));
}

function buildSeparatorLine(headerLine: string) {
  const columnCount = headerLine
    .split('|')
    .slice(1, -1)
    .length;

  if (columnCount <= 0) {
    return null;
  }

  return `|${Array.from({ length: columnCount }, () => ' --- ').join('|')}|`;
}

export function normalizeMarkdownTables(content: string) {
  const lines = content.split('\n');
  const result: string[] = [];

  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (!isTableLine(line)) {
      result.push(line);
      i += 1;
      continue;
    }

    const tableLines: string[] = [];
    while (i < lines.length && isTableLine(lines[i])) {
      tableLines.push(lines[i].trim());
      i += 1;
    }

    if (tableLines.length >= 1 && !isSeparatorLine(tableLines[1] ?? '')) {
      const separator = buildSeparatorLine(tableLines[0]);
      if (separator) {
        tableLines.splice(1, 0, separator);
      }
    }

    result.push(...tableLines);
  }

  return result.join('\n');
}
