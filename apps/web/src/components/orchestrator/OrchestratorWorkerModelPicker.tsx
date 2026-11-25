import {
  AuthOrchestrationOperateScope,
  type ModelSelection,
  type OrchestratorWorkerPolicy,
  type ProviderInstanceId,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import { BotIcon, CheckIcon, ChevronDownIcon, ShieldCheckIcon } from "lucide-react";

import type { AppModelOption } from "../../modelSelection";
import type { ProviderInstanceEntry } from "../../providerInstances";
import { useQuietThreadShell } from "../../state/entities";
import { useEnvironmentScope } from "../../state/session";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { ComposerControl } from "../chat/ComposerControl";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "../ui/menu";

function resolveWorkerDisplayName(
  policy: OrchestratorWorkerPolicy | undefined,
  modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<AppModelOption>>,
): string | null {
  if (policy?.mode !== "manual") return null;
  const options = modelOptionsByInstance.get(policy.modelSelection.instanceId);
  const matched = options?.find((option) => option.slug === policy.modelSelection.model);
  if (matched) return matched.name;
  const raw = policy.modelSelection.model;
  const slashIndex = raw.lastIndexOf("/");
  return slashIndex >= 0 && slashIndex < raw.length - 1 ? raw.slice(slashIndex + 1) : raw;
}

export function OrchestratorWorkerModelPicker(props: {
  readonly routeThreadRef: ScopedThreadRef | null;
  readonly providerInstanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  readonly modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<AppModelOption>>;
  readonly size: "xs" | "sm";
  readonly compact?: boolean;
  readonly disabled: boolean;
}) {
  const {
    routeThreadRef,
    providerInstanceEntries,
    modelOptionsByInstance,
    size,
    compact = false,
    disabled,
  } = props;
  const gt = useGT();
  const threadShell = useQuietThreadShell(routeThreadRef);
  const canOperate = useEnvironmentScope(
    routeThreadRef?.environmentId ?? null,
    AuthOrchestrationOperateScope,
  );
  const setWorkerPolicy = useAtomCommand(threadEnvironment.setOrchestratorWorkerPolicy, {
    reportFailure: false,
  });

  if (routeThreadRef === null || threadShell?.lineage.orchestrator !== true) {
    return null;
  }

  const policy: OrchestratorWorkerPolicy = threadShell.orchestratorWorkerPolicy ?? { mode: "auto" };
  const manualModelName = resolveWorkerDisplayName(policy, modelOptionsByInstance);
  const isManual = policy.mode === "manual";

  const applyPolicy = (nextPolicy: OrchestratorWorkerPolicy) => {
    if (!canOperate) return;
    void setWorkerPolicy({
      environmentId: routeThreadRef.environmentId,
      input: {
        threadId: routeThreadRef.threadId,
        workerPolicy: nextPolicy,
      },
    });
  };

  const handleSelectManualModel = (instanceId: ProviderInstanceId, slug: string) => {
    const modelSelection: ModelSelection = { instanceId, model: slug };
    applyPolicy({ mode: "manual", modelSelection });
  };

  const enabledInstances = providerInstanceEntries.filter((entry) => {
    const options = modelOptionsByInstance.get(entry.instanceId);
    return options !== undefined && options.length > 0;
  });

  return (
    <Menu>
      <MenuTrigger
        render={
          <ComposerControl
            type="button"
            size={size}
            disabled={disabled || !canOperate}
            className="min-w-0 shrink"
            data-testid="orchestrator-worker-model-trigger"
            aria-label={gt("Worker model")}
          >
            <BotIcon className="size-3.5 shrink-0" />
            <span className={compact ? "max-w-20 truncate" : "max-w-36 truncate"}>
              {isManual && manualModelName ? manualModelName : gt("Auto")}
            </span>
            <ChevronDownIcon className="size-3 shrink-0 opacity-60" />
          </ComposerControl>
        }
      />
      <MenuPopup align="end" side="top" className="min-w-60">
        <div className="px-2.5 py-1.5 text-2xs text-muted-foreground">
          <T>Choose which model runs delegated sub-agent tasks</T>
        </div>
        <MenuSeparator />
        <MenuItem onClick={() => applyPolicy({ mode: "auto" })}>
          <ShieldCheckIcon className="size-3.5 shrink-0" />
          <div className="flex min-w-0 flex-1 flex-col">
            <span>
              <T>Auto</T>
            </span>
            <span className="text-2xs text-muted-foreground">
              <T>Orchestrator picks per role</T>
            </span>
          </div>
          {!isManual ? <CheckIcon className="size-3.5 shrink-0" /> : null}
        </MenuItem>

        <MenuSub>
          <MenuSubTrigger>
            <BotIcon className="size-3.5 shrink-0" />
            <div className="flex min-w-0 flex-1 flex-col">
              <span>
                <T>Manual</T>
              </span>
              <span className="truncate text-2xs text-muted-foreground">
                {isManual && manualModelName ? manualModelName : gt("One model for all workers")}
              </span>
            </div>
            {isManual ? <CheckIcon className="size-3.5 shrink-0" /> : null}
          </MenuSubTrigger>
          <MenuSubPopup className="max-h-80 min-w-56 overflow-y-auto">
            {enabledInstances.length === 0 ? (
              <MenuItem disabled>
                <T>No provider models available</T>
              </MenuItem>
            ) : enabledInstances.length === 1 ? (
              (modelOptionsByInstance.get(enabledInstances[0]!.instanceId) ?? []).map((option) => {
                const selected =
                  isManual &&
                  policy.modelSelection.instanceId === enabledInstances[0]!.instanceId &&
                  policy.modelSelection.model === option.slug;
                return (
                  <MenuItem
                    key={option.slug}
                    onClick={() =>
                      handleSelectManualModel(enabledInstances[0]!.instanceId, option.slug)
                    }
                  >
                    <span className="min-w-0 flex-1 truncate">{option.name}</span>
                    {selected ? <CheckIcon className="size-3.5 shrink-0" /> : null}
                  </MenuItem>
                );
              })
            ) : (
              enabledInstances.map((entry) => {
                const options = modelOptionsByInstance.get(entry.instanceId) ?? [];
                const activeInInstance =
                  isManual && policy.modelSelection.instanceId === entry.instanceId;
                return (
                  <MenuSub key={entry.instanceId}>
                    <MenuSubTrigger>
                      <span className="min-w-0 flex-1 truncate">{entry.displayName}</span>
                      {activeInInstance ? <CheckIcon className="size-3.5 shrink-0" /> : null}
                    </MenuSubTrigger>
                    <MenuSubPopup className="max-h-80 min-w-56 overflow-y-auto">
                      {options.map((option) => {
                        const selected =
                          activeInInstance && policy.modelSelection.model === option.slug;
                        return (
                          <MenuItem
                            key={`${entry.instanceId}:${option.slug}`}
                            onClick={() => handleSelectManualModel(entry.instanceId, option.slug)}
                          >
                            <span className="min-w-0 flex-1 truncate">{option.name}</span>
                            {selected ? <CheckIcon className="size-3.5 shrink-0" /> : null}
                          </MenuItem>
                        );
                      })}
                    </MenuSubPopup>
                  </MenuSub>
                );
              })
            )}
          </MenuSubPopup>
        </MenuSub>

        <MenuSeparator />
        <div className="px-2.5 py-1.5 text-2xs text-muted-foreground">
          {isManual && manualModelName
            ? gt("New workers use {model}", { model: manualModelName })
            : gt("Orchestrator chooses worker models")}
        </div>
      </MenuPopup>
    </Menu>
  );
}
