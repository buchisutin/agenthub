import { Router } from "express";
import { PreviewService } from "./preview.service.js";

export function createPreviewRouter(previewService: PreviewService): Router {
  const router = Router();

  router.post("/runs/:runId/preview/start", async (req, res) => {
    try {
      const preview = await previewService.startPreviewForRun(req.params.runId);
      res.json(preview);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to start preview";
      const status = /run not found/i.test(message)
        ? 404
        : /workspace|completed|previewed|ports available|invalid/i.test(message)
          ? 400
          : 500;
      res.status(status).json({ detail: message });
    }
  });

  router.post("/runs/:runId/preview/stop", async (req, res) => {
    try {
      const result = await previewService.stopPreviewForRun(req.params.runId);
      res.json(result);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to stop preview";
      res.status(500).json({ detail: message });
    }
  });

  router.post("/workspaces/:workspaceId/preview/start", async (req, res) => {
    try {
      res.json(await previewService.startPreviewForWorkspace(req.params.workspaceId));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to start preview";
      const status = /not found/i.test(message)
        ? 404
        : /workspace|previewed|ports available|invalid/i.test(message)
          ? 400
          : 500;
      res.status(status).json({ detail: message });
    }
  });

  router.post("/workspaces/:workspaceId/preview/stop", async (req, res) => {
    try {
      res.json(await previewService.stopPreviewForWorkspace(req.params.workspaceId));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to stop preview";
      res.status(500).json({ detail: message });
    }
  });

  return router;
}
