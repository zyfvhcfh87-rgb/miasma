import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import type { MergedUsage } from "@t3tools/shared/usageMerge";
import { userEvent } from "vite-plus/test/browser";
import { describe, expect, it, vi } from "vite-plus/test";

import "~/index.css";

import { render } from "../../../test/render";
import { ComposerUsageMeter } from "./ComposerUsageMeter";

const envId = EnvironmentId.make("local");
const checkedAt = "2026-10-30T11:59:00.000Z";

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

vi.mock("../../state/usage", async (original) => {
  const actual = await original<typeof import("../../state/usage")>();
  return {
    ...actual,
    useUsage: () => ({
      shown: { window: {}, merged },
      merged,
      environments: [],
      selectedEnvironments: [],
      isPartial: false,
      refresh: () => Promise.resolve(),
    }),
  };
});

function makeCodexProvider(): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make("codex"),
    driver: ProviderDriverKind.make("codex"),
    displayName: "Codex",
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated", label: "Personal" },
    checkedAt,
    models: [{ slug: "gpt-5", name: "GPT 5", isCustom: false, capabilities: null }],
    slashCommands: [],
    skills: [],
  };
}

describe("ComposerUsageMeter", () => {
  it("renders today's spend in the strip and opens a popover with the token count", async () => {
    const provider = makeCodexProvider();
    await using screen = await render(
      <ComposerUsageMeter
        standalone
        environmentId={envId}
        providerInstanceId={provider.instanceId}
        model="gpt-5"
        providers={[provider]}
      />,
    );

    const trigger = screen.getByRole("button", { name: /Today's spend: \$1\.25/i });
    await expect.element(trigger).toBeVisible();
    expect(screen.container.textContent).toContain("Today");
    expect(screen.container.textContent).toContain("$1.25");

    await userEvent.click(trigger);
    await expect.element(screen.getByText(/Today's spend/)).toBeVisible();
    await expect.element(screen.getByText("50K")).toBeVisible();
    await expect.element(screen.getByRole("link", { name: /Open Usage/i })).toBeVisible();
  });
});
