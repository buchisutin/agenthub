import fs from "node:fs";
import path from "node:path";
import { createAgentHubServer } from "./app.js";

// Lightweight .env loader — no dotenv dependency
const envPath = path.resolve(import.meta.dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (key && !process.env[key]) {
      process.env[key] = value;
    }
  }
}

const server = createAgentHubServer();

server.httpServer.listen(server.env.port, () => {
  console.log(`AgentHub local server listening on http://localhost:${server.env.port}`);
});

async function shutdown() {
  await server.close();
}

process.on("SIGINT", () => {
  void shutdown().finally(() => process.exit(0));
});

process.on("SIGTERM", () => {
  void shutdown().finally(() => process.exit(0));
});
