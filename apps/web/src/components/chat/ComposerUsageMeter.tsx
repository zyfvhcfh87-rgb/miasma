import {
  type EnvironmentId,
  type ProviderInstanceId,
  type ServerProvider,
  type UsageLimitSourceSnapshots,
} from "@t3tools/contracts";
import { normalizeProviderAccentColor } from "@t3tools/client-runtime/state/provider-instance-display";
import { settlePromise } from "@t3tools/client-runtime/state/runtime";
import { refreshUsageLimits } from "@t3tools/client-runtime/state/usage";
import { type LimitPace } from "@t3tools/shared/usageLimits";
import { formatDuration } from "@t3tools/shared/usageLimitsCopy";
import { formatTokens, formatUsd, makeWindow } from "@t3tools/shared/usageFormat";
import { Link } from "@tanstack/react-router";
import { msg, T, useGT, useLocale, useMessages } from "gt-react";
import { CircleAlertIcon, ExternalLinkIcon } from "lucide-react";
import { Fragment, use, useState } from "react";

import { useNowMinute } from "../../hooks/useNowMinute";
import { usePrimarySettings } from "../../hooks/useSettings";
import { cn } from "../../lib/utils";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { useUsage } from "../../state/usage";
import { formatUpcomingTimestamp } from "../../timestampFormat";
import { providerClients } from "../settings/providerDriverMeta";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { RefreshIcon } from "../ui/refresh-icon";
import { barColor, ResetCredits } from "../usage/UsageLimits";
import { HiddenThreadContext } from "./backgroundThread";
import { ComposerControl } from "./ComposerControl";
import { useComposerMenuProps } from "./composerEventScope";
import { ComposerSurface } from "./ComposerSurface";
import {
  type ComposerTodaySpend,
  type ComposerUsageMeterState,
  type ComposerUsageTone,
  type ComposerUsageWindowItem,
  needsComposerTodaySpendFallback,
  resolveComposerUsageMeter,
  resolveProviderTodaySpend,
} from "./ComposerUsageMeter.logic";
import { useComposerMenuState } from "./useComposerMenuState";

const PACE_LABEL: Record<LimitPace, string> = {
  ahead: msg("Ahead of pace"),
  on: msg("On pace"),
  under: msg("Under pace"),
};

export interface ComposerUsageMeterProps {
  readonly environmentId: EnvironmentId;
  readonly providerInstanceId: ProviderInstanceId | null;
  readonly model: string | null;
  readonly providers: readonly ServerProvider[];
  readonly sources: UsageLimitSourceSnapshots;
  readonly standalone?: boolean | undefined;
  readonly className?: string | undefined;
}

function providerAccent(provider: ServerProvider): string {
  return normalizeProviderAccentColor(provider.accentColor) ?? barColor(provider.driver);
}

function providerTitle(provider: ServerProvider): string {
  const driverLabel = providerClients.get(provider.driver)?.label ?? String(provider.driver);
  const customName = provider.displayName?.trim();
  return customName && customName.toLowerCase() !== driverLabel.toLowerCase()
    ? `${driverLabel} · ${customName}`
    : driverLabel;
}

function toneTextClass(tone: ComposerUsageTone): string {
  if (tone === "error") return "text-error-foreground";
  if (tone === "warning") return "text-warning-foreground";
  return "text-foreground/85";
}

function toneFillClass(tone: ComposerUsageTone): string | null {
  if (tone === "error") return "bg-error";
  if (tone === "warning") return "bg-warning";
  return null;
}

function InlineWindowChip({
  item,
  accent,
}: {
  readonly item: ComposerUsageWindowItem;
  readonly accent: string;
}) {
  const fillClass = toneFillClass(item.tone);
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className="text-muted-foreground">{item.shortLabel}</span>
      <span className="relative inline-block h-[3px] w-9 rounded-full bg-muted-foreground/30 sm:w-10 dark:bg-muted-foreground/20">
        {item.remainingPercent > 0 ? (
          <span
            className={cn("absolute inset-y-0 left-0 rounded-full", fillClass)}
            style={{
              width: `max(${item.remainingPercent}%, 4px)`,
              ...(fillClass === null ? { backgroundColor: accent } : {}),
            }}
          />
        ) : null}
        {item.timeLeftPercent !== null ? (
          <span
            aria-hidden="true"
            className="absolute -top-[2px] h-[7px] w-px -translate-x-1/2 rounded-full bg-foreground/80"
            style={{ left: `clamp(0.5px, ${item.timeLeftPercent}%, calc(100% - 0.5px))` }}
          />
        ) : null}
      </span>
      <span className={cn("font-medium tabular-nums", toneTextClass(item.tone))}>
        {item.remainingPercent}%
      </span>
    </span>
  );
}

function PopoverWindowRow({
  item,
  accent,
  now,
}: {
  readonly item: ComposerUsageWindowItem;
  readonly accent: string;
  readonly now: number;
}) {
  const gt = useGT();
  const messages = useMessages();
  const timestampFormat = usePrimarySettings((settings) => settings.timestampFormat);
  const fillClass = toneFillClass(item.tone);
  const hasFutureReset =
    item.resetsAt !== null && item.resetsAtMs !== null && item.resetsAtMs > now;
  const resetText =
    hasFutureReset && item.resetsAt && item.resetsAtMs !== null
      ? item.accountsCount > 1 && item.restoresPercent !== null
        ? gt("+{percent}% in {duration} · {time}", {
            percent: item.restoresPercent,
            duration: formatDuration(item.resetsAtMs - now, messages),
            time: formatUpcomingTimestamp(item.resetsAt, timestampFormat, now, undefined, messages),
          })
        : gt("Resets in {duration} · {time}", {
            duration: formatDuration(item.resetsAtMs - now, messages),
            time: formatUpcomingTimestamp(item.resetsAt, timestampFormat, now, undefined, messages),
          })
      : null;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="min-w-0 truncate text-muted-foreground">{item.fullLabel}</span>
        <span className={cn("shrink-0 font-medium tabular-nums", toneTextClass(item.tone))}>
          {gt("{left}% left", { left: item.remainingPercent })}
        </span>
      </div>
      <div className="relative h-1.5 w-full rounded-full bg-muted-foreground/20">
        {item.remainingPercent > 0 ? (
          <div
            className={cn("absolute inset-y-0 left-0 rounded-full", fillClass)}
            style={{
              width: `max(${item.remainingPercent}%, 3px)`,
              ...(fillClass === null ? { backgroundColor: accent } : {}),
            }}
          />
        ) : null}
        {item.timeLeftPercent !== null ? (
          <span
            aria-hidden="true"
            className="absolute -top-0.5 h-2.5 w-0.5 -translate-x-1/2 rounded-full bg-foreground/85"
            style={{ left: `clamp(1px, ${item.timeLeftPercent}%, calc(100% - 1px))` }}
          />
        ) : null}
      </div>
      {item.pace || resetText ? (
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <span>
            {item.pace && item.timeLeftPercent !== null
              ? `${messages(PACE_LABEL[item.pace])} · ${gt("{timeLeft}% time left", { timeLeft: item.timeLeftPercent })}`
              : item.pace
                ? messages(PACE_LABEL[item.pace])
                : null}
          </span>
          {resetText ? <span className="tabular-nums">{resetText}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

function ComposerUsageMeterView({
  environmentId,
  state,
  now,
  standalone = false,
  className,
}: {
  readonly environmentId: EnvironmentId;
  readonly state: ComposerUsageMeterState;
  readonly now: number;
  readonly standalone?: boolean | undefined;
  readonly className?: string | undefined;
}) {
  const gt = useGT();
  const locale = useLocale();
  const composerMenuProps = useComposerMenuProps();
  const [open, setOpen] = useComposerMenuState(use(HiddenThreadContext));
  const [refreshing, setRefreshing] = useState(false);
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });

  const accent = providerAccent(state.provider);
  const title = providerTitle(state.provider);
  const plan = state.provider.auth.label;

  const handleRefresh = () => {
    if (refreshing) return;
    setRefreshing(true);
    void settlePromise(() =>
      refreshUsageLimits(
        environmentId,
        () => refreshProviders({ environmentId, input: {} }),
        false,
      ),
    ).then(() => {
      setRefreshing(false);
    });
  };

  const triggerAriaLabel =
    state.kind === "windows"
      ? state.inlineWindows
          .map((item) =>
            gt("{label}: {left}% left", { label: item.fullLabel, left: item.remainingPercent }),
          )
          .join(", ")
      : state.kind === "spend"
        ? state.spend.costKnown
          ? gt("Today's spend: {cost}", { cost: formatUsd(state.spend.costUsd, locale) })
          : gt("Today's usage: {tokens} tokens", { tokens: formatTokens(state.spend.totalTokens) })
        : gt("Usage limits unavailable");

  const meter = (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <ComposerControl
            size="xs"
            data-composer-usage-meter="true"
            aria-label={triggerAriaLabel}
            className={cn("min-w-0 shrink-0 gap-2", className)}
          />
        }
      >
        {state.kind === "windows" ? (
          <>
            {state.inlineWindows.map((item, index) => (
              <Fragment key={item.id}>
                {index > 0 ? (
                  <span aria-hidden="true" className="text-muted-foreground/45">
                    ·
                  </span>
                ) : null}
                <InlineWindowChip item={item} accent={accent} />
              </Fragment>
            ))}
            {state.hiddenCount > 0 ? (
              <span className="text-muted-foreground/75 tabular-nums">+{state.hiddenCount}</span>
            ) : null}
          </>
        ) : state.kind === "spend" ? (
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <span className="text-muted-foreground">
              {state.spend.scopeLabel ? state.spend.scopeLabel : <T>Today</T>}
            </span>
            <span className="font-medium text-foreground/85 tabular-nums">
              {state.spend.costKnown
                ? formatUsd(state.spend.costUsd, locale)
                : gt("{tokens} tok", { tokens: formatTokens(state.spend.totalTokens) })}
            </span>
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 whitespace-nowrap text-muted-foreground">
            <CircleAlertIcon className="size-3.5 shrink-0" aria-hidden="true" />
            <span>
              <T>Limits</T>
            </span>
          </span>
        )}
      </PopoverTrigger>
      <PopoverPopup side="top" align="end" width="md" padding="compact" {...composerMenuProps}>
        <div className="flex flex-col gap-2.5 px-1 py-1">
          <div className="flex items-center justify-between gap-2 border-b border-border/60 pb-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <span
                aria-hidden="true"
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: accent }}
              />
              <span className="shrink-0 font-medium text-foreground text-xs">{title}</span>
              {plan ? (
                <span className="min-w-0 truncate text-muted-foreground text-xs">· {plan}</span>
              ) : null}
            </div>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={gt("Refresh usage limits")}
              disabled={refreshing}
              onClick={handleRefresh}
            >
              <RefreshIcon refreshing={refreshing} size="sm" />
            </Button>
          </div>

          {state.kind === "windows" ? (
            <div className="flex flex-col gap-2.5">
              {state.allWindows.map((item) => (
                <PopoverWindowRow key={item.id} item={item} accent={accent} now={now} />
              ))}
              {state.limits?.resetCredits ? (
                <ResetCredits
                  environmentId={environmentId}
                  input={{ instanceId: state.provider.instanceId }}
                  credits={state.limits.resetCredits}
                  now={now}
                />
              ) : null}
            </div>
          ) : state.kind === "spend" ? (
            <div className="flex flex-col gap-1 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">
                  {state.spend.scopeLabel ? (
                    gt("Today ({scope})", { scope: state.spend.scopeLabel })
                  ) : (
                    <T>Today&apos;s spend</T>
                  )}
                </span>
                <span className="font-medium text-foreground tabular-nums">
                  {state.spend.costKnown
                    ? formatUsd(state.spend.costUsd, locale)
                    : gt("Cost unavailable")}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 text-muted-foreground">
                <span>
                  <T>Tokens</T>
                </span>
                <span className="tabular-nums">{formatTokens(state.spend.totalTokens)}</span>
              </div>
              <p className="pt-1 text-muted-foreground leading-relaxed">
                <T>This provider does not report quota windows. Showing local usage for today.</T>
              </p>
            </div>
          ) : (
            <p className="text-muted-foreground text-xs leading-relaxed">{state.notice}</p>
          )}

          <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-2 text-xs">
            <span className="text-muted-foreground">
              {state.kind === "windows" ? <T>Tick marks even pace</T> : null}
            </span>
            <Link
              to="/usage"
              onClick={() => setOpen(false)}
              className="inline-flex items-center gap-1 font-medium text-foreground hover:underline"
            >
              <span>
                <T>Open Usage</T>
              </span>
              <ExternalLinkIcon className="size-3" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  );

  if (standalone) {
    return (
      <ComposerSurface.ContextStrip className="justify-end gap-1 text-xs font-normal text-foreground/70 dark:text-muted-foreground">
        {meter}
      </ComposerSurface.ContextStrip>
    );
  }

  return meter;
}

function ComposerTodaySpendMeter({
  environmentId,
  provider,
  model,
  now,
  standalone,
  className,
}: {
  readonly environmentId: EnvironmentId;
  readonly provider: ServerProvider;
  readonly model: string | null;
  readonly now: number;
  readonly standalone?: boolean | undefined;
  readonly className?: string | undefined;
}) {
  // Stable daily key so the usage summary query only refreshes across day boundaries.
  const todayWindow = makeWindow(1, new Date(now));
  const selectedEnvironments = new Set<EnvironmentId>([environmentId]);
  const usage = useUsage(todayWindow, selectedEnvironments);
  const spend: ComposerTodaySpend | null = resolveProviderTodaySpend({
    driver: provider.driver,
    model,
    merged: usage.shown?.merged ?? null,
  });
  if (!spend) return null;
  return (
    <ComposerUsageMeterView
      environmentId={environmentId}
      state={{ kind: "spend", provider, spend }}
      now={now}
      standalone={standalone}
      className={className}
    />
  );
}

/**
 * Compact usage meter docked in the composer's context strip.
 * Shows remaining quota windows (`% left`) for the selected provider/model, or falls back
 * lazily to today's local spend for providers that do not expose subscription quotas.
 */
export function ComposerUsageMeter(props: ComposerUsageMeterProps) {
  const messages = useMessages();
  const nowMinute = useNowMinute();
  const now = Date.parse(`${nowMinute}:00Z`);

  const state = resolveComposerUsageMeter(
    {
      providerInstanceId: props.providerInstanceId,
      model: props.model,
      providers: props.providers,
      sources: props.sources,
      now,
      todaySpend: null,
    },
    messages,
  );

  if (state !== null) {
    return (
      <ComposerUsageMeterView
        environmentId={props.environmentId}
        state={state}
        now={now}
        standalone={props.standalone}
        className={props.className}
      />
    );
  }

  const shouldQuerySpend = needsComposerTodaySpendFallback({
    providerInstanceId: props.providerInstanceId,
    model: props.model,
    providers: props.providers,
    sources: props.sources,
    now,
  });
  const provider = props.providers.find((entry) => entry.instanceId === props.providerInstanceId);

  if (!shouldQuerySpend || !provider) return null;

  return (
    <ComposerTodaySpendMeter
      environmentId={props.environmentId}
      provider={provider}
      model={props.model}
      now={now}
      standalone={props.standalone}
      className={props.className}
    />
  );
}
