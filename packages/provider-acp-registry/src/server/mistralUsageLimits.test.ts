import { describe, expect, it } from "vite-plus/test";

import {
  isMistralVibeSettings,
  mistralBudgetResponseToLimits,
  parseDotEnvValue,
} from "./mistralUsageLimits.ts";

const checkedAt = "2026-11-24T19:00:00.000Z";

describe("mistralUsageLimits", () => {
  it("parses nested vibe_budget response into a monthly spend window", () => {
    const limits = mistralBudgetResponseToLimits(
      {
        vibe_budget: {
          initial_budget: 300,
          usage_percentage: 1.6366667,
          currency: "USD",
          reset_at: "2026-12-01T00:00:00Z",
        },
      },
      checkedAt,
    );

    expect(limits.unavailable).toBeUndefined();
    expect(limits.windows).toEqual([
      {
        id: "mistral_vibe_budget",
        kind: "monthly",
        label: "Vibe · $4.91 / $300",
        usedPercent: 1.6366667,
        windowDurationMins: 30 * 24 * 60,
        resetsAt: "2026-12-01T00:00:00.000Z",
      },
    ]);
  });

  it("parses flat budget response with EUR currency", () => {
    const limits = mistralBudgetResponseToLimits(
      {
        initial_budget: 200,
        usage_percentage: 25,
        currency: "EUR",
        reset_at: "2026-12-01T00:00:00Z",
      },
      checkedAt,
    );

    expect(limits.windows).toEqual([
      {
        id: "mistral_vibe_budget",
        kind: "monthly",
        label: "Monthly · €50 / €200",
        usedPercent: 25,
        windowDurationMins: 30 * 24 * 60,
        resetsAt: "2026-12-01T00:00:00.000Z",
      },
    ]);
  });

  it("reads MISTRAL_API_KEY from .env format", () => {
    const envFile = `
      # comment
      OTHER=123
      export MISTRAL_API_KEY="sk-mistral-secret"
    `;
    expect(parseDotEnvValue(envFile, "MISTRAL_API_KEY")).toBe("sk-mistral-secret");
  });

  it("identifies Mistral Vibe registry and local executables", () => {
    expect(
      isMistralVibeSettings({ source: "registry", agentId: "mistral-vibe", commandPath: "" }),
    ).toBe(true);
    expect(
      isMistralVibeSettings({
        source: "local",
        agentId: "",
        commandPath: "/usr/local/bin/vibe-acp",
      }),
    ).toBe(true);
    expect(
      isMistralVibeSettings({ source: "registry", agentId: "claude-acp", commandPath: "" }),
    ).toBe(false);
  });
});
