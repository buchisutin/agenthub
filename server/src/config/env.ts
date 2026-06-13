import path from "node:path";

export interface EnvConfig {
  port: number;
  dbPath: string;
  claudeCommand: string;
  claudeBaseArgs: string[];
  claudeAllowedTools: string[];
  claudeDisallowedTools: string[];
  codexCommand: string;
  codexBaseArgs: string[];
}

function parseCsv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function getEnvConfig(overrides: Partial<EnvConfig> = {}): EnvConfig {
  const defaultClaudeAllowedTools = [
    "Read",
    "Edit",
    "Write",
    "Glob",
    "Grep",
    "Bash(npm *)",
    "Bash(git *)",
    "Bash(python *)",
    "Bash(pytest *)",
    "Bash(node *)",
    "Bash(find *)",
    "Bash(ls *)",
    "Bash(cat *)",
  ];
  const defaultClaudeDisallowedTools = [
    "Bash(rm -rf *)",
    "Bash(sudo *)",
    "Bash(git push *)",
  ];

  return {
    port: Number(process.env.PORT ?? 8000),
    dbPath:
      process.env.DB_PATH ?? path.resolve(process.cwd(), "agenthub-local.sqlite"),
    claudeCommand: process.env.CLAUDE_COMMAND ?? "claude",
    claudeBaseArgs: parseCsv(process.env.CLAUDE_BASE_ARGS).length
      ? parseCsv(process.env.CLAUDE_BASE_ARGS)
      : [
          "-p",
          "--bare",
          "--verbose",
          "--output-format",
          "stream-json",
          "--permission-mode",
          "acceptEdits",
        ],
    claudeAllowedTools: parseCsv(process.env.CLAUDE_ALLOWED_TOOLS).length
      ? parseCsv(process.env.CLAUDE_ALLOWED_TOOLS)
      : defaultClaudeAllowedTools,
    claudeDisallowedTools: parseCsv(process.env.CLAUDE_DISALLOWED_TOOLS).length
      ? parseCsv(process.env.CLAUDE_DISALLOWED_TOOLS)
      : defaultClaudeDisallowedTools,
    codexCommand: process.env.CODEX_COMMAND ?? "codex",
    codexBaseArgs: parseCsv(process.env.CODEX_BASE_ARGS).length
      ? parseCsv(process.env.CODEX_BASE_ARGS)
      : ["-s", "workspace-write", "-a", "never"],
    ...overrides,
  };
}
