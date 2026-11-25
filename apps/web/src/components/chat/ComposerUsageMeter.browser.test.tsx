import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { userEvent } from "vite-plus/test/browser";
import { describe, expect, it } from "vite-plus/test";

import "~/index.css";

import { render } from "../../../test/render";
import { ComposerUsageMeter } from "./ComposerUsageMeter";

const envId = EnvironmentId.make("local");
const checkedAt = "2026-10-30T11:59:00.000Z";

function makeAntigravityProvider(): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make("antigravity"),
    driver: ProviderDriverKind.make("antigravity"),
    displayName: "Antigravity",
    enabled: true,
    installed: true,
    version: "2.24.0",
    status: "ready",
    auth: { status: "authenticated", label: "Personal" },
    checkedAt,
    models: [],
    slashCommands: [],
    skills: [],
    usageLimits: {
      checkedAt,
      windows: [
        {
          id: "gemini-5h",
          kind: "session",
          label: "Gemini · 5-hour",
          usedPercent: 26,
          windowDurationMins: 300,
          resetsAt: "2026-10-30T15:00:00.000Z",
        },
        {
          id: "gemini-weekly",
          kind: "weekly",
          label: "Gemini · Weekly",
          usedPercent: 42,
          windowDurationMins: 7 * 24 * 60,
          resetsAt: "2026-11-04T15:00:00.000Z",
        },
        {
          id: "3p-5h",
          kind: "session",
          label: "Claude & GPT (shared) · 5-hour",
          usedPercent: 90,
          windowDurationMins: 300,
          resetsAt: "2026-10-30T15:00:00.000Z",
        },
      ],
    },
  };
}

function makeMistralVibeProvider(): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make("acpRegistry_mistral"),
    driver: ProviderDriverKind.make("acpRegistry"),
    displayName: "Mistral Vibe",
    enabled: true,
    installed: true,
    version: "2.25.5",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt,
    models: [],
    slashCommands: [],
    skills: [],
    usageLimits: {
      checkedAt,
      windows: [
        {
          id: "mistral_vibe_budget",
          kind: "monthly",
          label: "Vibe · $4.91 / $300",
          usedPercent: 1.64,
          windowDurationMins: 30 * 24 * 60,
          resetsAt: "2026-11-05T12:00:00.000Z",
        },
      ],
    },
  };
}

describe("ComposerUsageMeter", () => {
  it("renders inline 5h and Wk % left bars for Antigravity Gemini and opens detailed popover", async () => {
    const provider = makeAntigravityProvider();
    await using screen = await render(
      <ComposerUsageMeter
        standalone
        environmentId={envId}
        providerInstanceId={provider.instanceId}
        model="gemini-4-neon"
        providers={[provider]}
        sources={[]}
      />,
    );

    const trigger = screen.getByRole("button", { name: /Gemini · 5-hour: 74% left/i });
    await expect.element(trigger).toBeVisible();
    await expect.element(trigger).toHaveTextContent("5h");
    await expect.element(trigger).toHaveTextContent("74%");
    await expect.element(trigger).toHaveTextContent("Wk");
    await expect.element(trigger).toHaveTextContent("58%");

    await userEvent.click(trigger);
    await expect.element(screen.getByText("Gemini · 5-hour")).toBeVisible();
    await expect.element(screen.getByText("Gemini · Weekly")).toBeVisible();
    await expect.element(screen.getByRole("link", { name: /Open Usage/i })).toBeVisible();
  });

  it("renders Mistral Vibe monthly spend budget in the strip and popover", async () => {
    const provider = makeMistralVibeProvider();
    await using screen = await render(
      <ComposerUsageMeter
        standalone
        environmentId={envId}
        providerInstanceId={provider.instanceId}
        model="devstral-2"
        providers={[provider]}
        sources={[]}
      />,
    );

    const trigger = screen.getByRole("button", { name: /Vibe · \$4\.91 \/ \$300: 98% left/i });
    await expect.element(trigger).toBeVisible();
    await expect.element(trigger).toHaveTextContent("Mo");
    await expect.element(trigger).toHaveTextContent("98%");

    await userEvent.click(trigger);
    await expect.element(screen.getByText("Vibe · $4.91 / $300")).toBeVisible();
    await expect.element(screen.getByText("98% left")).toBeVisible();
  });
});
