import { ProviderDriverKind } from "@t3tools/contracts";
import type { MergedUsage } from "@t3tools/shared/usageMerge";
import { describe, expect, it } from "vite-plus/test";

import { resolveProviderTodaySpend } from "./ComposerUsageMeter.logic";

describe("ComposerUsageMeter.logic", () => {
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

  it("falls back to the provider's totals when the model has no sub-provider prefix", () => {
    const merged = {
      providers: [{ provider: "codex", costUsd: 1.25, totalTokens: 50_000 }],
      models: [
        {
          provider: "codex",
          model: "gpt-5",
          costUsd: 1.25,
          totalTokens: 50_000,
          records: 2,
          unpricedRecords: 0,
        },
      ],
    } as unknown as MergedUsage;

    expect(
      resolveProviderTodaySpend({
        driver: ProviderDriverKind.make("codex"),
        model: "gpt-5",
        merged,
      }),
    ).toEqual({
      costUsd: 1.25,
      costKnown: true,
      totalTokens: 50_000,
      scopeLabel: null,
    });
  });

  it("returns null without merged usage or a usage-known provider driver", () => {
    expect(
      resolveProviderTodaySpend({
        driver: ProviderDriverKind.make("codex"),
        model: "gpt-5",
        merged: null,
      }),
    ).toBeNull();
    const merged = {
      providers: [],
      models: [],
    } as unknown as MergedUsage;
    expect(
      resolveProviderTodaySpend({
        driver: ProviderDriverKind.make("codex"),
        model: "gpt-5",
        merged,
      }),
    ).toBeNull();
  });
});
