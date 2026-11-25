import type { ServerProviderUsageLimits, ServerProviderUsageWindow } from "@t3tools/contracts";
import {
  clampPercent,
  makeUnavailableUsageLimits,
  makeUsageLimits,
} from "@t3tools/provider-core/server/usageLimits";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

import type { AcpRegistrySettings } from "../settings.ts";

const MISTRAL_BUDGET_URL = "https://api.mistral.ai/v1/billing/budget";
const MONTH_DURATION_MINS = 30 * 24 * 60;

const MistralBudgetEntry = Schema.Struct({
  initial_budget: Schema.optional(Schema.NullOr(Schema.Number)),
  usage_percentage: Schema.optional(Schema.NullOr(Schema.Number)),
  currency: Schema.optional(Schema.NullOr(Schema.String)),
  reset_at: Schema.optional(Schema.NullOr(Schema.String)),
});

export const MistralBudgetResponse = Schema.Struct({
  vibe_budget: Schema.optional(Schema.NullOr(MistralBudgetEntry)),
  api_budget: Schema.optional(Schema.NullOr(MistralBudgetEntry)),
  initial_budget: Schema.optional(Schema.NullOr(Schema.Number)),
  usage_percentage: Schema.optional(Schema.NullOr(Schema.Number)),
  currency: Schema.optional(Schema.NullOr(Schema.String)),
  reset_at: Schema.optional(Schema.NullOr(Schema.String)),
});

const decodeMistralBudget = Schema.decodeUnknownEffect(MistralBudgetResponse);

export function isMistralVibeSettings(
  settings: Pick<AcpRegistrySettings, "source" | "agentId" | "commandPath">,
): boolean {
  if (settings.source === "local") {
    const executable = settings.commandPath.split(/[\\/]/).pop() ?? "";
    return /^(?:mistral-)?vibe(?:-acp)?(\.exe|\.cmd)?$/i.test(executable);
  }
  return settings.agentId === "mistral-vibe";
}

function formatBudgetAmount(amount: number, currency: string | null | undefined): string {
  const code = (currency?.trim() || "USD").toUpperCase();
  const isWhole = Math.abs(amount - Math.round(amount)) < 0.005;
  const formattedNumber = isWhole ? String(Math.round(amount)) : amount.toFixed(2);
  if (code === "USD") return `$${formattedNumber}`;
  if (code === "EUR") return `€${formattedNumber}`;
  if (code === "GBP") return `£${formattedNumber}`;
  return `${formattedNumber} ${code}`;
}

function isoDateTime(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const parsed = DateTime.make(value);
  return Option.isSome(parsed) ? DateTime.formatIso(parsed.value) : undefined;
}

function budgetEntryToWindow(
  id: string,
  prefix: string,
  entry: typeof MistralBudgetEntry.Type | null | undefined,
): ServerProviderUsageWindow | undefined {
  if (!entry) return undefined;
  const usagePercent = entry.usage_percentage;
  if (typeof usagePercent !== "number" || !Number.isFinite(usagePercent)) return undefined;
  const usedPercent = clampPercent(usagePercent);
  const initialBudget =
    typeof entry.initial_budget === "number" &&
    Number.isFinite(entry.initial_budget) &&
    entry.initial_budget > 0
      ? entry.initial_budget
      : null;
  const spendSummary =
    initialBudget !== null
      ? `${formatBudgetAmount((initialBudget * usedPercent) / 100, entry.currency)} / ${formatBudgetAmount(initialBudget, entry.currency)}`
      : null;
  const label = spendSummary ? `${prefix} · ${spendSummary}` : prefix;
  const resetsAt = isoDateTime(entry.reset_at);
  return {
    id,
    kind: "monthly",
    label,
    usedPercent,
    windowDurationMins: MONTH_DURATION_MINS,
    ...(resetsAt ? { resetsAt } : {}),
  };
}

export function mistralBudgetResponseToLimits(
  response: typeof MistralBudgetResponse.Type,
  checkedAt: string,
): ServerProviderUsageLimits {
  const windows: ServerProviderUsageWindow[] = [];
  const vibe = budgetEntryToWindow("mistral_vibe_budget", "Vibe", response.vibe_budget);
  if (vibe) windows.push(vibe);
  const api = budgetEntryToWindow("mistral_api_budget", "API", response.api_budget);
  if (api) windows.push(api);
  if (windows.length === 0) {
    const flat = budgetEntryToWindow("mistral_vibe_budget", "Monthly", response);
    if (flat) windows.push(flat);
  }
  return windows.length > 0
    ? makeUsageLimits({ checkedAt, windows })
    : makeUnavailableUsageLimits({ checkedAt, reason: "unsupported" });
}

export function parseDotEnvValue(contents: string, keyName: string): string | undefined {
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const stripped = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const eqIndex = stripped.indexOf("=");
    if (eqIndex <= 0) continue;
    const key = stripped.slice(0, eqIndex).trim();
    if (key !== keyName) continue;
    let value = stripped.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1).trim();
    }
    if (value.length > 0) return value;
  }
  return undefined;
}

const readMistralApiKey = Effect.fn("readMistralApiKey")(function* (
  environment: NodeJS.ProcessEnv,
) {
  const fromEnv = environment.MISTRAL_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const homeDirectory = Option.getOrUndefined(
    yield* Effect.serviceOption(HostProcess.HomeDirectory),
  );
  const resolvedHome = environment.HOME || environment.USERPROFILE || homeDirectory;
  const home =
    environment.VIBE_HOME?.trim() || (resolvedHome ? path.join(resolvedHome, ".vibe") : "");
  if (!home) return undefined;
  const envContents = yield* fs
    .readFileString(path.join(home, ".env"))
    .pipe(Effect.orElseSucceed(() => ""));
  return parseDotEnvValue(envContents, "MISTRAL_API_KEY");
});

export const readMistralVibeUsageLimits = Effect.fn("readMistralVibeUsageLimits")(function* (
  environment: NodeJS.ProcessEnv,
) {
  const httpClientOption = yield* Effect.serviceOption(HttpClient.HttpClient);
  if (Option.isNone(httpClientOption)) return undefined;
  const apiKey = yield* readMistralApiKey(environment).pipe(Effect.orElseSucceed(() => undefined));
  if (!apiKey) return undefined;
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  return yield* Effect.gen(function* () {
    const response = yield* httpClientOption.value.execute(
      HttpClientRequest.get(MISTRAL_BUDGET_URL).pipe(HttpClientRequest.bearerToken(apiKey)),
    );
    if (response.status === 401 || response.status === 403 || response.status === 404) {
      return makeUnavailableUsageLimits({ checkedAt, reason: "unsupported" });
    }
    const body = yield* HttpClientResponse.filterStatusOk(response).pipe(
      Effect.flatMap((ok) => ok.json),
      Effect.flatMap(decodeMistralBudget),
    );
    return mistralBudgetResponseToLimits(body, checkedAt);
  }).pipe(
    Effect.timeout("10 seconds"),
    Effect.orElseSucceed(() =>
      makeUnavailableUsageLimits({
        checkedAt,
        reason: "probeFailed",
        message: "Could not read Mistral Vibe usage limits.",
      }),
    ),
  );
});
