import type { ProviderDriverKind } from "@t3tools/contracts";
import { isModelCostUnknown, type MergedUsage } from "@t3tools/shared/usageMerge";

import { PROVIDER_PRESENTATION } from "../usage/usageProviders";

export interface ComposerTodaySpend {
  readonly costUsd: number;
  readonly costKnown: boolean;
  readonly totalTokens: number;
  readonly scopeLabel: string | null;
}

function driverToUsageProviderKind(driver: ProviderDriverKind) {
  const entry = Object.entries(PROVIDER_PRESENTATION).find(
    ([, presentation]) => presentation.driverKind === driver,
  );
  return entry ? entry[0] : null;
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
