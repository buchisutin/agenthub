import { describe, it, expect } from "vitest";
import { getEnvConfig } from "../src/config/env.js";

describe("getEnvConfig planner vars", () => {
  it("returns undefined plannerApiUrl when PLANNER_API_URL is not set", () => {
    const env = getEnvConfig();
    // undefined is acceptable — PlannerAgentService will throw at call time
    expect(env.plannerApiUrl).toBeUndefined();
  });

  it("reads PLANNER_API_URL from process.env", () => {
    process.env.PLANNER_API_URL = "https://test.example.com/v1";
    process.env.PLANNER_API_KEY = "test-key";
    process.env.PLANNER_MODEL = "test-model";
    const env = getEnvConfig();
    expect(env.plannerApiUrl).toBe("https://test.example.com/v1");
    expect(env.plannerApiKey).toBe("test-key");
    expect(env.plannerModel).toBe("test-model");
    delete process.env.PLANNER_API_URL;
    delete process.env.PLANNER_API_KEY;
    delete process.env.PLANNER_MODEL;
  });
});
