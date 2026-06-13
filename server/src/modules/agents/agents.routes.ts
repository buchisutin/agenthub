import { Router } from "express";
import { AgentsService } from "./agents.service.js";

function toBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  return undefined;
}

export function createAgentsRouter(agentsService: AgentsService): Router {
  const router = Router();

  router.get("/", (req, res) => {
    const includeDisabled = req.query.includeDisabled === "true";
    res.json(agentsService.listAgents({ includeDisabled }));
  });

  router.get("/:agentId", (req, res) => {
    const agent = agentsService.getAgent(req.params.agentId);
    if (!agent) {
      res.status(404).json({ detail: "Agent not found" });
      return;
    }
    res.json(agent);
  });

  router.post("/", (req, res) => {
    try {
      const agent = agentsService.createAgent({
        name: req.body?.name,
        slug: req.body?.slug,
        adapterType: req.body?.adapterType,
        instructions: req.body?.instructions,
        capabilities: Array.isArray(req.body?.capabilities) ? req.body.capabilities : undefined,
        enabled: toBoolean(req.body?.enabled),
        isDefault: toBoolean(req.body?.isDefault),
      });
      res.status(201).json(agent);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create agent";
      res.status(400).json({ detail: message });
    }
  });

  router.patch("/:agentId", (req, res) => {
    try {
      const agent = agentsService.updateAgent(req.params.agentId, {
        name: req.body?.name,
        slug: req.body?.slug,
        adapterType: req.body?.adapterType,
        instructions: req.body?.instructions,
        capabilities: Array.isArray(req.body?.capabilities) ? req.body.capabilities : undefined,
        enabled: toBoolean(req.body?.enabled),
        isDefault: toBoolean(req.body?.isDefault),
      });
      res.json(agent);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update agent";
      const status = /not found/i.test(message) ? 404 : 400;
      res.status(status).json({ detail: message });
    }
  });

  router.post("/:agentId/default", (req, res) => {
    try {
      res.json(agentsService.setDefaultAgent(req.params.agentId));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to set default agent";
      const status = /not found/i.test(message) ? 404 : 400;
      res.status(status).json({ detail: message });
    }
  });

  router.post("/:agentId/disable", (req, res) => {
    try {
      res.json(agentsService.disableAgent(req.params.agentId));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to disable agent";
      const status = /not found/i.test(message) ? 404 : 400;
      res.status(status).json({ detail: message });
    }
  });

  router.post("/:agentId/enable", (req, res) => {
    try {
      res.json(agentsService.enableAgent(req.params.agentId));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to enable agent";
      const status = /not found/i.test(message) ? 404 : 400;
      res.status(status).json({ detail: message });
    }
  });

  router.delete("/:agentId", (req, res) => {
    try {
      agentsService.deleteAgent(req.params.agentId);
      res.status(204).end();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to delete agent";
      const status = /not found/i.test(message) ? 404 : 400;
      res.status(status).json({ detail: message });
    }
  });

  return router;
}
