import type {
  ProviderDriverKind,
  ProviderInstanceId,
  ServerProvider,
  ServerProviderUsageLimits,
  ServerProviderUsageWindow,
  UsageLimitSourceSnapshots,
  UsageProviderKind,
} from "@t3tools/contracts";
import {
  antigravityWindowLimitsModel,
  type LimitPace,
  type LimitPoolWindow,
  paceOf,
  paceRemainingPercent,
  remainingPercent,
} from "@t3tools/shared/usageLimits";
import { limitsNotice } from "@t3tools/shared/usageLimitsCopy";
import { isModelCostUnknown, type MergedUsage } from "@t3tools/shared/usageMerge";
import { msg } from "gt-react";

import { m, type MessageResolver } from "../../i18n/messages";
import { PROVIDER_PRESENTATION } from "../usage/usageProviders";
import { nextPoolReset, poolSources, resolveThreadDetailsLimits } from "./ThreadDetailsUsage.logic";

export type ComposerUsageTone = "error" | "warning" | null;

export interface ComposerUsageWindowItem {
  readonly id: string;
  readonly kind: ServerProviderUsageWindow["kind"];
  readonly shortLabel: string;
  readonly fullLabel: string;
  readonly remainingPercent: number;
  readonly timeLeftPercent: number | null;
  readonly pace: LimitPace | null;
  readonly tone: ComposerUsageTone;
  readonly resetsAt: string | null;
  readonly resetsAtMs: number | null;
  readonly accountsCount: number;
  readonly restoresPercent: number | null;
  readonly sourceLabels: readonly string[];
  readonly window?: ServerProviderUsageWindow | undefined;
}

export interface ComposerTodaySpend {
  readonly costUsd: number;
  readonly costKnown: boolean;
  readonly totalTokens: number;
  readonly scopeLabel: string | null;
}

export type ComposerUsageMeterState =
  | {
      readonly kind: "windows";
      readonly provider: ServerProvider;
      readonly inlineWindows: readonly ComposerUsageWindowItem[];
      readonly allWindows: readonly ComposerUsageWindowItem[];
      readonly hiddenCount: number;
      readonly limits: ServerProviderUsageLimits | null;
    }
  | {
      readonly kind: "spend";
      readonly provider: ServerProvider;
      readonly spend: ComposerTodaySpend;
    }
  | {
      readonly kind: "notice";
      readonly provider: ServerProvider;
      readonly notice: string;
      readonly limits: ServerProviderUsageLimits;
    };

const WINDOW_KIND_ORDER: Record<ServerProviderUsageWindow["kind"], number> = {
  session: 0,
  weekly: 1,
  monthly: 2,
  other: 3,
};

const CLAUDE_SCOPED_WEEKLY_PREFIX = "seven_day_";

function claudeScopeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

function claudeWindowMatchesModel(
  window: Pick<ServerProviderUsageWindow, "id">,
  model: string | null,
): boolean {
  if (!window.id.startsWith(CLAUDE_SCOPED_WEEKLY_PREFIX)) return true;
  if (model === null) return false;
  return claudeScopeToken(model).includes(window.id.slice(CLAUDE_SCOPED_WEEKLY_PREFIX.length));
}

function composerUsageTone(left: number): ComposerUsageTone {
  if (left <= 10) return "error";
  if (left <= 20) return "warning";
  return null;
}

function driverToUsageProviderKind(driver: ProviderDriverKind): UsageProviderKind | null {
  const entry = Object.entries(PROVIDER_PRESENTATION).find(
    ([, presentation]) => presentation.driverKind === driver,
  );
  return entry ? (entry[0] as UsageProviderKind) : null;
}

export function shortWindowLabel(
  window: Pick<ServerProviderUsageWindow, "kind" | "label" | "windowDurationMins">,
  resolve: MessageResolver = m,
): string {
  if (window.kind === "session") {
    const mins = window.windowDurationMins;
    if (mins !== undefined && mins > 0 && mins % 60 === 0) {
      return `${mins / 60}h`;
    }
    const hourMatch = window.label.match(/\b(\d+)\s*-?\s*h(?:our)?\b/i);
    if (hourMatch?.[1]) return `${hourMatch[1]}h`;
    return resolve(msg("Session", { $context: "short label for session usage window" }));
  }
  if (window.kind === "weekly") {
    return resolve(msg("Wk", { $context: "short label for weekly usage window" }));
  }
  if (window.kind === "monthly") {
    return resolve(msg("Mo", { $context: "short label for monthly usage window" }));
  }
  const hourMatch = window.label.match(/\b(\d+)\s*-?\s*h(?:our)?\b/i);
  if (hourMatch?.[1]) return `${hourMatch[1]}h`;
  if (/\bweekly\b/i.test(window.label)) {
    return resolve(msg("Wk", { $context: "short label for weekly usage window" }));
  }
  if (/\bmonthly\b/i.test(window.label)) {
    return resolve(msg("Mo", { $context: "short label for monthly usage window" }));
  }
  const segments = window.label
    .split("·")
    .map((segment) => segment.trim())
    .filter(Boolean);
  const tail = segments[segments.length - 1] ?? window.label.trim();
  return tail.length <= 10
    ? tail
    : resolve(msg("Limit", { $context: "short label for usage limit" }));
}

function windowMatchesModelMetadata(
  window: Pick<ServerProviderUsageWindow, "modelIds" | "providerIds">,
  model: string | null,
): boolean {
  if (model === null) return true;
  if (window.modelIds !== undefined && !window.modelIds.includes(model)) return false;
  if (window.providerIds !== undefined) {
    const modelProvider = model.split("/")[0] ?? "";
    if (!window.providerIds.includes(modelProvider)) return false;
  }
  return true;
}

function filterWindowsForModel<
  T extends Pick<ServerProviderUsageWindow, "id" | "kind" | "label"> & {
    readonly modelIds?: readonly string[] | undefined;
    readonly providerIds?: readonly string[] | undefined;
  },
>(driver: ProviderDriverKind, model: string | null, windows: readonly T[]): readonly T[] {
  if (windows.length === 0) return [];

  let filtered = windows.filter((window) => windowMatchesModelMetadata(window, model));

  switch (driver) {
    case "antigravity": {
      const familyMatches = filtered.filter((window) =>
        antigravityWindowLimitsModel(window, model),
      );
      if (familyMatches.length > 0) filtered = familyMatches;
      break;
    }
    case "claudeAgent": {
      const scopedMatches = filtered.filter((window) => claudeWindowMatchesModel(window, model));
      if (scopedMatches.length > 0) filtered = scopedMatches;
      break;
    }
    case "opencode": {
      if (model !== null) {
        filtered = filtered.filter(
          (window) => !window.id.startsWith("go_") || model.startsWith("opencode-go/"),
        );
      }
      break;
    }
    case "cursor": {
      const hasAuto = filtered.some((window) => window.id === "autoPercentUsed");
      const hasApi = filtered.some((window) => window.id === "apiPercentUsed");
      if (hasAuto && hasApi) {
        filtered = filtered.filter((window) => window.id !== "totalPercentUsed");
      }
      if (model !== null) {
        const prefersAuto = /^(auto|default|grok|composer)/i.test(model);
        const preferredId = prefersAuto ? "autoPercentUsed" : "apiPercentUsed";
        filtered = [...filtered].sort(
          (left, right) => Number(left.id !== preferredId) - Number(right.id !== preferredId),
        );
      }
      break;
    }
    default:
      break;
  }

  return [...filtered].sort((left, right) => {
    const kindDiff = WINDOW_KIND_ORDER[left.kind] - WINDOW_KIND_ORDER[right.kind];
    if (kindDiff !== 0) return kindDiff;
    if (driver === "antigravity") {
      const geminiDiff =
        Number(!left.id.startsWith("gemini-")) - Number(!right.id.startsWith("gemini-"));
      if (geminiDiff !== 0) return geminiDiff;
    }
    return 0;
  });
}

function selectInlineWindows(
  windows: readonly ComposerUsageWindowItem[],
): readonly ComposerUsageWindowItem[] {
  if (windows.length <= 2) return windows;
  const session = windows.find((window) => window.kind === "session");
  const weekly = windows.find((window) => window.kind === "weekly");
  if (session && weekly) return [session, weekly];
  return windows.slice(0, 2);
}

function toInstanceWindowItem(
  window: ServerProviderUsageWindow,
  now: number,
  resolve: MessageResolver,
): ComposerUsageWindowItem {
  const left = remainingPercent(window);
  const resetsAtMs = window.resetsAt ? Date.parse(window.resetsAt) : Number.NaN;
  return {
    id: window.id,
    kind: window.kind,
    shortLabel: shortWindowLabel(window, resolve),
    fullLabel: window.label,
    remainingPercent: left,
    timeLeftPercent: paceRemainingPercent(window, now),
    pace: paceOf(window, now),
    tone: composerUsageTone(left),
    resetsAt: window.resetsAt ?? null,
    resetsAtMs: Number.isFinite(resetsAtMs) ? resetsAtMs : null,
    accountsCount: 1,
    restoresPercent: null,
    sourceLabels: [],
    window,
  };
}

function toPoolWindowItem(
  window: LimitPoolWindow,
  now: number,
  resolve: MessageResolver,
): ComposerUsageWindowItem {
  const left = window.remainingPercent;
  const next = nextPoolReset(window, now);
  const from = poolSources(window);
  const sampleWindow = window.members[0]?.window;
  const timeLeftPercent =
    window.members.length === 1 && sampleWindow ? paceRemainingPercent(sampleWindow, now) : null;
  return {
    id: window.id,
    kind: window.kind,
    shortLabel: shortWindowLabel(
      {
        kind: window.kind,
        label: window.label,
        windowDurationMins: sampleWindow?.windowDurationMins,
      },
      resolve,
    ),
    fullLabel: window.label,
    remainingPercent: left,
    timeLeftPercent,
    pace: window.pace,
    tone: composerUsageTone(left),
    resetsAt: next?.member.window.resetsAt ?? null,
    resetsAtMs: next?.at ?? null,
    accountsCount: window.members.length,
    restoresPercent: next ? next.restoresPercent : null,
    sourceLabels: [...from.hubs, ...(from.signedIn ? [resolve(msg("Signed-in accounts"))] : [])],
    ...(window.members.length === 1 && sampleWindow ? { window: sampleWindow } : {}),
  };
}

/**
 * Extracts today's spend for a provider (narrowed to a sub-provider prefix such as `mistral/`
 * or `deepinfra/` when OpenCode/Pi models carry one).
 */
export function resolveProviderTodaySpend(input: {
  readonly driver: ProviderDriverKind;
  readonly model: string | null;
  readonly merged: MergedUsage | null;
}): ComposerTodaySpend | null {
  if (!input.merged) return null;
  const usageProvider = driverToUsageProviderKind(input.driver);
  if (!usageProvider) return null;

  const modelPrefix = input.model?.includes("/") ? input.model.split("/")[0]?.trim() : null;
  const providerModels = input.merged.models.filter((entry) => entry.provider === usageProvider);

  if (modelPrefix) {
    const scopedModels = providerModels.filter((entry) =>
      entry.model.toLowerCase().startsWith(`${modelPrefix.toLowerCase()}/`),
    );
    if (scopedModels.length > 0) {
      const totalTokens = scopedModels.reduce((sum, entry) => sum + entry.totalTokens, 0);
      const costUsd = scopedModels.reduce((sum, entry) => sum + entry.costUsd, 0);
      const costKnown = scopedModels.some((entry) => !isModelCostUnknown(entry));
      if (totalTokens > 0 || costUsd > 0) {
        return { costUsd, costKnown, totalTokens, scopeLabel: modelPrefix };
      }
    }
  }

  const providerTotals = input.merged.providers.find((entry) => entry.provider === usageProvider);
  if (!providerTotals || (providerTotals.totalTokens <= 0 && providerTotals.costUsd <= 0)) {
    return null;
  }
  const costKnown =
    providerModels.length === 0 || providerModels.some((entry) => !isModelCostUnknown(entry));
  return {
    costUsd: providerTotals.costUsd,
    costKnown,
    totalTokens: providerTotals.totalTokens,
    scopeLabel: null,
  };
}

export function resolveComposerUsageMeter(
  input: {
    readonly providerInstanceId: ProviderInstanceId | null;
    readonly model: string | null;
    readonly providers: readonly ServerProvider[];
    readonly sources: UsageLimitSourceSnapshots;
    readonly now: number;
    readonly todaySpend: ComposerTodaySpend | null;
  },
  resolve: MessageResolver = m,
): ComposerUsageMeterState | null {
  const provider = input.providers.find((entry) => entry.instanceId === input.providerInstanceId);
  if (!provider) return null;

  const resolved = resolveThreadDetailsLimits(
    input.providerInstanceId,
    input.model,
    input.providers,
    input.sources,
    input.now,
  );

  if (resolved?.kind === "pool") {
    const filtered = filterWindowsForModel(provider.driver, input.model, resolved.windows);
    const allWindows = filtered.map((window) => toPoolWindowItem(window, input.now, resolve));
    if (allWindows.length > 0) {
      const inlineWindows = selectInlineWindows(allWindows);
      return {
        kind: "windows",
        provider,
        inlineWindows,
        allWindows,
        hiddenCount: allWindows.length - inlineWindows.length,
        limits: null,
      };
    }
  }

  if (resolved?.kind === "instance") {
    const notice = limitsNotice(resolved.limits, resolve);
    if (notice === null) {
      const filtered = filterWindowsForModel(provider.driver, input.model, resolved.limits.windows);
      const allWindows = filtered.map((window) => toInstanceWindowItem(window, input.now, resolve));
      if (allWindows.length > 0) {
        const inlineWindows = selectInlineWindows(allWindows);
        return {
          kind: "windows",
          provider,
          inlineWindows,
          allWindows,
          hiddenCount: allWindows.length - inlineWindows.length,
          limits: resolved.limits,
        };
      }
    } else if (resolved.limits.unavailable?.reason === "probeFailed") {
      return {
        kind: "notice",
        provider,
        notice,
        limits: resolved.limits,
      };
    }
  }

  if (input.todaySpend && (input.todaySpend.totalTokens > 0 || input.todaySpend.costUsd > 0)) {
    return {
      kind: "spend",
      provider,
      spend: input.todaySpend,
    };
  }

  return null;
}

/** True when the active provider has no quota windows, so the UI may query today's spend fallback. */
export function needsComposerTodaySpendFallback(input: {
  readonly providerInstanceId: ProviderInstanceId | null;
  readonly model: string | null;
  readonly providers: readonly ServerProvider[];
  readonly sources: UsageLimitSourceSnapshots;
  readonly now: number;
}): boolean {
  const provider = input.providers.find((entry) => entry.instanceId === input.providerInstanceId);
  if (!provider || driverToUsageProviderKind(provider.driver) === null) return false;
  const withoutSpend = resolveComposerUsageMeter({ ...input, todaySpend: null });
  return withoutSpend === null;
}
