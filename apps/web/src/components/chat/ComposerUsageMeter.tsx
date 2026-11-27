import {
  type EnvironmentId,
  type ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { normalizeProviderAccentColor } from "@t3tools/client-runtime/state/provider-instance-display";
import { formatTokens, formatUsd, makeWindow } from "@t3tools/shared/usageFormat";
import { Link } from "@tanstack/react-router";
import { T, useGT, useLocale } from "gt-react";
import { ExternalLinkIcon } from "lucide-react";
import { use } from "react";

import { useNowMinute } from "../../hooks/useNowMinute";
import { cn } from "../../lib/utils";
import { useUsage } from "../../state/usage";
import { providerClients } from "../settings/providerDriverMeta";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { HiddenThreadContext } from "./backgroundThread";
import { ComposerControl } from "./ComposerControl";
import { useComposerMenuProps } from "./composerEventScope";
import { ComposerSurface } from "./ComposerSurface";
import { type ComposerTodaySpend, resolveProviderTodaySpend } from "./ComposerUsageMeter.logic";
import { useComposerMenuState } from "./useComposerMenuState";

export interface ComposerUsageMeterProps {
  readonly environmentId: EnvironmentId;
  readonly providerInstanceId: ProviderInstanceId | null;
  readonly model: string | null;
  readonly providers: readonly ServerProvider[];
  readonly standalone?: boolean | undefined;
  readonly className?: string | undefined;
}

function providerAccent(provider: ServerProvider): string {
  return normalizeProviderAccentColor(provider.accentColor) ?? "var(--foreground)";
}

function providerTitle(provider: ServerProvider): string {
  const driverLabel = providerClients.get(provider.driver)?.label ?? String(provider.driver);
  const customName = provider.displayName?.trim();
  return customName && customName.toLowerCase() !== driverLabel.toLowerCase()
    ? `${driverLabel} · ${customName}`
    : driverLabel;
}

function ComposerUsageMeterView({
  state,
  standalone = false,
  className,
}: {
  readonly state: { readonly provider: ServerProvider; readonly spend: ComposerTodaySpend };
  readonly standalone?: boolean | undefined;
  readonly className?: string | undefined;
}) {
  const gt = useGT();
  const locale = useLocale();
  const composerMenuProps = useComposerMenuProps();
  const [open, setOpen] = useComposerMenuState(use(HiddenThreadContext));

  const accent = providerAccent(state.provider);
  const title = providerTitle(state.provider);
  const plan = state.provider.auth.label;

  const triggerAriaLabel = state.spend.costKnown
    ? gt("Today's spend: {cost}", { cost: formatUsd(state.spend.costUsd, locale) })
    : gt("Today's usage: {tokens} tokens", { tokens: formatTokens(state.spend.totalTokens) });

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
      </PopoverTrigger>
      <PopoverPopup side="top" align="end" width="md" padding="compact" {...composerMenuProps}>
        <div className="flex flex-col gap-2.5 px-1 py-1">
          <div className="flex items-center gap-1.5 border-b border-border/60 pb-2">
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
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-border/60 pt-2 text-xs">
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

/**
 * Compact usage meter docked in the composer's context strip.
 * Shows today's local spend for the selected provider/model.
 */
export function ComposerUsageMeter(props: ComposerUsageMeterProps) {
  const nowMinute = useNowMinute();
  const now = Date.parse(`${nowMinute}:00Z`);

  // Stable daily key so the usage summary query only refreshes across day boundaries.
  const todayWindow = makeWindow(1, new Date(now));
  const selectedEnvironments = new Set<EnvironmentId>([props.environmentId]);
  const usage = useUsage(todayWindow, selectedEnvironments);
  const provider = props.providers.find((entry) => entry.instanceId === props.providerInstanceId);
  if (!provider) return null;
  const spend = resolveProviderTodaySpend({
    driver: provider.driver,
    model: props.model,
    merged: usage.shown?.merged ?? null,
  });
  if (!spend) return null;
  return (
    <ComposerUsageMeterView
      state={{ provider, spend }}
      standalone={props.standalone}
      className={props.className}
    />
  );
}
