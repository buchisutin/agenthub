import { createAgentHubServer } from "./app.js";

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
