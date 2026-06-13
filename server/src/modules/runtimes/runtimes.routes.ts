import { Router } from "express";
import { RuntimeRegistry } from "../../runtime/runtime-registry.js";

export function createRuntimesRouter(runtimeRegistry: RuntimeRegistry): Router {
  const router = Router();

  router.get("/runtimes", (_req, res) => {
    res.json(runtimeRegistry.listAdapters());
  });

  router.get("/runtimes/check", async (_req, res) => {
    const checks = await Promise.all(
      runtimeRegistry
        .listAdapters()
        .map((adapter) => runtimeRegistry.checkAdapter(adapter.adapterType)),
    );
    res.json(checks);
  });

  router.get("/runtimes/:adapterType/check", async (req, res) => {
    const info = runtimeRegistry.getAdapterInfo(req.params.adapterType);
    if (!info) {
      res.status(404).json({ detail: "Runtime adapter not found" });
      return;
    }
    res.json(await runtimeRegistry.checkAdapter(req.params.adapterType));
  });

  return router;
}
