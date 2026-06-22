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
  apiBaseUrl: string;
  hitlEnabled: boolean;
  plannerApiUrl: string | undefined;
  plannerApiKey: string | undefined;
  plannerModel: string | undefined;
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
    apiBaseUrl:
      process.env.AGENTHUB_API_URL ??
      `http://localhost:${Number(process.env.PORT ?? 8000)}`,
    hitlEnabled: process.env.HITL_ENABLED === "true",
    plannerApiUrl: process.env.PLANNER_API_URL,
    plannerApiKey: process.env.PLANNER_API_KEY,
    plannerModel: process.env.PLANNER_MODEL,
    ...overrides,
  };
}
