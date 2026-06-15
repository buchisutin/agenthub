import { Router } from "express";
import { DeployService } from "./deploy.service.js";

export function createDeployRouter(deployService: DeployService): Router {
  const router = Router();

  router.get("/runs/:runId/deploy/scripts", (req, res) => {
    try {
      res.json(deployService.getScriptsForRun(req.params.runId));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load deploy scripts";
      const status = /not found/i.test(message)
        ? 404
        : /workspace|completed|package/i.test(message)
          ? 400
          : 500;
      res.status(status).json({ detail: message });
    }
  });

  router.post("/runs/:runId/deploy/start", (req, res) => {
    try {
      const script = typeof req.body?.script === "string" ? req.body.script : undefined;
      res.json(deployService.startDeploy(req.params.runId, script));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to start deploy";
      const status = /not found/i.test(message)
        ? 404
        : /workspace|completed|package|script/i.test(message)
          ? 400
          : 500;
      res.status(status).json({ detail: message });
    }
  });

  router.get("/runs/:runId/deploy", (req, res) => {
    try {
      const deploy = deployService.getDeploy(req.params.runId);
      res.json(deploy);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load deploy";
      res.status(500).json({ detail: message });
    }
  });

  return router;
}
