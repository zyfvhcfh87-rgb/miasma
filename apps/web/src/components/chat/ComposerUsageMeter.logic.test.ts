import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  type ServerProviderUsageLimits,
  type ServerProviderUsageWindow,
} from "@t3tools/contracts";
import type { MergedUsage } from "@t3tools/shared/usageMerge";
import { describe, expect, it } from "vite-plus/test";

import {
  needsComposerTodaySpendFallback,
  resolveComposerUsageMeter,
  resolveProviderTodaySpend,
  shortWindowLabel,
} from "./ComposerUsageMeter.logic";

const now = Date.parse("2026-10-30T12:00:00.000Z");
const checkedAt = "2026-10-30T11:59:00.000Z";

function makeProvider(input: {
  readonly driver: string;
  readonly instanceId?: string;
  readonly usageLimits?: ServerProviderUsageLimits;
}): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(input.instanceId ?? input.driver),
    driver: ProviderDriverKind.make(input.driver),
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt,
    models: [],
    slashCommands: [],
    skills: [],
    ...(input.usageLimits ? { usageLimits: input.usageLimits } : {}),
  };
}

function makeWindow(
  overrides: Partial<ServerProviderUsageWindow> &
    Pick<ServerProviderUsageWindow, "id" | "kind" | "label" | "usedPercent">,
): ServerProviderUsageWindow {
  return {
    resetsAt: "2026-10-30T15:00:00.000Z",
    ...overrides,
  };
}

describe("ComposerUsageMeter.logic", () => {
  it("scopes Antigravity windows to the active Gemini model family and orders 5h before Weekly", () => {
    const provider = makeProvider({
      driver: "antigravity",
      usageLimits: {
        checkedAt,
        windows: [
          makeWindow({
            id: "gemini-weekly",
            kind: "weekly",
            label: "Gemini · Weekly",
            usedPercent: 42,
            windowDurationMins: 7 * 24 * 60,
          }),
          makeWindow({
            id: "gemini-5h",
            kind: "session",
            label: "Gemini · 5-hour",
            usedPercent: 26,
            windowDurationMins: 300,
          }),
          makeWindow({
            id: "gemini-argon-5h",
            kind: "session",
            label: "Gemini Argon · 5-hour",
            usedPercent: 90,
            windowDurationMins: 300,
          }),
          makeWindow({
            id: "3p-5h",
            kind: "session",
            label: "Claude & GPT (shared) · 5-hour",
            usedPercent: 80,
            windowDurationMins: 300,
          }),
        ],
      },
    });

    const state = resolveComposerUsageMeter({
      providerInstanceId: provider.instanceId,
      model: "gemini-4-neon",
      providers: [provider],
      sources: [],
      now,
      todaySpend: null,
    });

    expect(state?.kind).toBe("windows");
    if (state?.kind !== "windows") return;
    expect(state.inlineWindows.map((w) => [w.id, w.shortLabel, w.remainingPercent])).toEqual([
      ["gemini-5h", "5h", 74],
      ["gemini-weekly", "Wk", 58],
    ]);
    expect(state.hiddenCount).toBe(0);
  });

  it("shows Grok weekly subscription window with warning and error tones at low remaining %", () => {
    const provider = makeProvider({
      driver: "grok",
      usageLimits: {
        checkedAt,
        windows: [
          makeWindow({
            id: "subscription",
            kind: "weekly",
            label: "Weekly",
            usedPercent: 92,
            windowDurationMins: 7 * 24 * 60,
          }),
        ],
      },
    });

    const state = resolveComposerUsageMeter({
      providerInstanceId: provider.instanceId,
      model: "grok-code-fast-1",
      providers: [provider],
      sources: [],
      now,
      todaySpend: null,
    });

    expect(state?.kind).toBe("windows");
    if (state?.kind !== "windows") return;
    expect(state.inlineWindows).toHaveLength(1);
    expect(state.inlineWindows[0]).toMatchObject({
      shortLabel: "Wk",
      remainingPercent: 8,
      tone: "error",
    });
  });

  it("falls back to today's spend when OpenCode runs a third-party model outside OpenCode Go", () => {
    const provider = makeProvider({
      driver: "opencode",
      usageLimits: {
        checkedAt,
        windows: [
          makeWindow({
            id: "go_rolling",
            kind: "session",
            label: "Go · Session",
            usedPercent: 20,
            windowDurationMins: 300,
          }),
        ],
      },
    });

    expect(
      needsComposerTodaySpendFallback({
        providerInstanceId: provider.instanceId,
        model: "mistral/devstral-2",
        providers: [provider],
        sources: [],
        now,
      }),
    ).toBe(true);

    const state = resolveComposerUsageMeter({
      providerInstanceId: provider.instanceId,
      model: "mistral/devstral-2",
      providers: [provider],
      sources: [],
      now,
      todaySpend: { costUsd: 0.42, costKnown: true, totalTokens: 120_000, scopeLabel: "mistral" },
    });

    expect(state).toMatchObject({
      kind: "spend",
      spend: { costUsd: 0.42, scopeLabel: "mistral" },
    });
  });

  it("scopes today's spend to sub-provider prefix like mistral/ or deepinfra/ when present", () => {
    const merged = {
      providers: [{ provider: "opencode", costUsd: 3.5, totalTokens: 900_000 }],
      models: [
        {
          provider: "opencode",
          model: "mistral/devstral-2",
          costUsd: 0.42,
          totalTokens: 120_000,
          records: 3,
          unpricedRecords: 0,
        },
        {
          provider: "opencode",
          model: "deepinfra/meta-llama-3.3",
          costUsd: 3.08,
          totalTokens: 780_000,
          records: 5,
          unpricedRecords: 0,
        },
      ],
    } as unknown as MergedUsage;

    expect(
      resolveProviderTodaySpend({
        driver: ProviderDriverKind.make("opencode"),
        model: "mistral/devstral-2",
        merged,
      }),
    ).toEqual({
      costUsd: 0.42,
      costKnown: true,
      totalTokens: 120_000,
      scopeLabel: "mistral",
    });
  });

  it("formats compact labels cleanly for session, weekly, and monthly windows", () => {
    expect(shortWindowLabel({ kind: "session", label: "Session", windowDurationMins: 300 })).toBe(
      "5h",
    );
    expect(shortWindowLabel({ kind: "weekly", label: "Weekly" })).toBe("Wk");
    expect(shortWindowLabel({ kind: "monthly", label: "Vibe · $4.91 / $300" })).toBe("Mo");
  });
});
