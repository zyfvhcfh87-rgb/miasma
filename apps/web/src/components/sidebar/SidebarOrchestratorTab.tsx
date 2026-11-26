import type { EnvironmentServerConfig } from "@t3tools/client-runtime/connection";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  threadRuntimeIsActive,
  type EnvironmentProject,
  type EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/models";
import {
  AuthOrchestrationOperateScope,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_SERVER_SETTINGS,
  type EnvironmentId,
  type ModelSelection,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { T, useGT } from "gt-react";
import {
  ArchiveIcon,
  BotIcon,
  FolderPlusIcon,
  MoreHorizontalIcon,
  PlusIcon,
  RotateCcwIcon,
} from "lucide-react";
import { useState } from "react";

import { openCommandPalette } from "../../commandPaletteBus";
import { readEnvironmentScope } from "../../state/session";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { cn, newThreadId } from "../../lib/utils";
import { ProjectFavicon } from "../ProjectFavicon";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";

function resolveDefaultModelSelection(input: {
  readonly project: EnvironmentProject;
  readonly fallbackSelection: ModelSelection | null;
}): ModelSelection | null {
  return input.project.defaultModelSelection ?? input.fallbackSelection;
}

export function SidebarOrchestratorTab(props: {
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly orchestratorThreads: ReadonlyArray<EnvironmentThreadShell>;
  readonly activeThreadKey: string | null;
  readonly serverConfigs: ReadonlyMap<EnvironmentId, EnvironmentServerConfig>;
  readonly defaultModelSelectionByEnvironment: ReadonlyMap<string, ModelSelection>;
  readonly onSelectThread: (threadRef: ScopedThreadRef) => void;
}) {
  const {
    projects,
    orchestratorThreads,
    activeThreadKey,
    serverConfigs,
    defaultModelSelectionByEnvironment,
    onSelectThread,
  } = props;
  const gt = useGT();
  const createThread = useAtomCommand(threadEnvironment.create, { reportFailure: false });
  const archiveThread = useAtomCommand(threadEnvironment.archive, { reportFailure: false });
  const [creatingProjectKey, setCreatingProjectKey] = useState<string | null>(null);

  const activeCountByProjectKey = new Map<string, number>();
  for (const thread of orchestratorThreads) {
    const key = `${thread.environmentId}:${thread.projectId}`;
    activeCountByProjectKey.set(key, (activeCountByProjectKey.get(key) ?? 0) + 1);
  }

  const projectByKey = new Map<string, EnvironmentProject>(
    projects.map((project) => [`${project.environmentId}:${project.id}`, project] as const),
  );

  const sortedOrchestrators = [...orchestratorThreads].toSorted((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );

  const availableProjectsToAdd = projects.filter(
    (project) =>
      project.archivedAt == null &&
      !project.isScratch &&
      !activeCountByProjectKey.has(`${project.environmentId}:${project.id}`),
  );

  const launchOrchestratorForProject = async (project: EnvironmentProject) => {
    const projectKey = `${project.environmentId}:${project.id}`;
    if (creatingProjectKey !== null) return;
    if (!readEnvironmentScope(project.environmentId, AuthOrchestrationOperateScope)) {
      toastManager.add({
        type: "error",
        title: gt("Permission required"),
        description: gt("You do not have permission to start threads in this environment."),
      });
      return;
    }
    const modelSelection = resolveDefaultModelSelection({
      project,
      fallbackSelection: defaultModelSelectionByEnvironment.get(project.environmentId) ?? null,
    });
    if (modelSelection === null) {
      toastManager.add({
        type: "error",
        title: gt("No provider configured"),
        description: gt("Enable a provider in Settings before starting an orchestrator."),
      });
      return;
    }
    setCreatingProjectKey(projectKey);
    const threadId = newThreadId();
    const serverSettings =
      serverConfigs.get(project.environmentId)?.settings ?? DEFAULT_SERVER_SETTINGS;
    const runtimeMode = resolveProjectSettings(serverSettings, project.id, project).settings
      .defaultRuntimeMode;
    const result = await createThread({
      environmentId: project.environmentId,
      input: {
        threadId,
        projectId: project.id,
        title: project.title,
        modelSelection,
        runtimeMode,
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        branch: null,
        worktreePath: null,
        orchestrator: true,
        orchestratorWorkerPolicy: { mode: "auto" },
      },
    });
    setCreatingProjectKey(null);
    if (result._tag === "Success") {
      onSelectThread(scopeThreadRef(project.environmentId, threadId));
      return;
    }
    if (!isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: gt("Could not start orchestrator"),
        ...(error instanceof Error ? { description: error.message } : {}),
      });
    }
  };

  const handleRemoveOrchestrator = async (thread: EnvironmentThreadShell) => {
    const result = await archiveThread({
      environmentId: thread.environmentId,
      input: { threadId: thread.id },
    });
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: gt("Could not remove orchestrator project"),
        ...(error instanceof Error ? { description: error.message } : {}),
      });
    }
  };

  const handleResetOrchestrator = async (
    thread: EnvironmentThreadShell,
    project: EnvironmentProject | null,
  ) => {
    await handleRemoveOrchestrator(thread);
    if (project) {
      await launchOrchestratorForProject(project);
    }
  };

  return (
    <div className="flex flex-1 flex-col gap-2 px-1" data-testid="sidebar-orchestrator-tab">
      <div className="flex items-center justify-between px-1.5 pt-1">
        <span className="text-2xs font-medium tracking-wide text-sidebar-muted-foreground uppercase">
          <T>Projects</T>
        </span>
        <Menu>
          <MenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={gt("Add project to Orchestrator")}
                data-testid="sidebar-orchestrator-add-project"
              >
                <PlusIcon className="size-3.5" />
              </Button>
            }
          />
          <MenuPopup align="end" className="max-h-80 min-w-56 overflow-y-auto">
            {availableProjectsToAdd.length > 0 ? (
              <>
                {availableProjectsToAdd.map((project) => (
                  <MenuItem
                    key={`${project.environmentId}:${project.id}`}
                    onClick={() => void launchOrchestratorForProject(project)}
                  >
                    <ProjectFavicon project={project} className="size-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{project.title}</span>
                  </MenuItem>
                ))}
                <MenuSeparator />
              </>
            ) : null}
            <MenuItem onClick={() => openCommandPalette({ open: "add-project" })}>
              <FolderPlusIcon className="size-3.5 shrink-0" />
              <span>
                <T>Add folder…</T>
              </span>
            </MenuItem>
          </MenuPopup>
        </Menu>
      </div>

      {sortedOrchestrators.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-sidebar-border px-3 py-6 text-center">
          <BotIcon className="size-5 text-sidebar-muted-foreground/70" />
          <p className="text-xs font-medium text-sidebar-foreground">
            <T>No orchestrator projects yet</T>
          </p>
          <p className="text-2xs text-sidebar-muted-foreground">
            <T>Add a project for a continuous manager chat that delegates work to sub-agents.</T>
          </p>
          {availableProjectsToAdd.length > 0 ? (
            <Menu>
              <MenuTrigger
                render={
                  <Button type="button" variant="outline" size="xs">
                    <PlusIcon className="size-3" />
                    <T>Add project</T>
                  </Button>
                }
              />
              <MenuPopup align="center" className="max-h-72 min-w-52 overflow-y-auto">
                {availableProjectsToAdd.map((project) => (
                  <MenuItem
                    key={`${project.environmentId}:${project.id}`}
                    onClick={() => void launchOrchestratorForProject(project)}
                  >
                    <ProjectFavicon project={project} className="size-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{project.title}</span>
                  </MenuItem>
                ))}
              </MenuPopup>
            </Menu>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => openCommandPalette({ open: "add-project" })}
            >
              <FolderPlusIcon className="size-3" />
              <T>Add folder</T>
            </Button>
          )}
        </div>
      ) : (
        <ul className="flex flex-col gap-0.5" role="list" aria-label={gt("Orchestrator projects")}>
          {sortedOrchestrators.map((thread) => {
            const ref = scopeThreadRef(thread.environmentId, thread.id);
            const key = scopedThreadKey(ref);
            const isSelected = activeThreadKey === key;
            const projectKey = `${thread.environmentId}:${thread.projectId}`;
            const project = projectByKey.get(projectKey) ?? null;
            const projectTitle = project?.title ?? thread.title;
            const hasMultipleForProject = (activeCountByProjectKey.get(projectKey) ?? 0) > 1;
            const disambiguator = hasMultipleForProject
              ? thread.title && thread.title !== projectTitle
                ? thread.title
                : new Date(thread.updatedAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })
              : null;
            const counts = thread.orchestratorTaskCounts;
            const isWorking =
              threadRuntimeIsActive(thread.runtime) || (counts?.inProgress ?? 0) > 0;
            const needsAttention =
              thread.hasPendingApprovals ||
              thread.hasPendingUserInput ||
              (counts?.needsAttention ?? 0) > 0;
            const badgeText = needsAttention
              ? gt("Needs you")
              : (counts?.inProgress ?? 0) > 0
                ? String(counts!.inProgress)
                : (counts?.forReview ?? 0) > 0
                  ? String(counts!.forReview)
                  : null;

            return (
              <li key={key} className="group relative flex items-center">
                <button
                  type="button"
                  onClick={() => onSelectThread(ref)}
                  className={cn(
                    "flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-sm transition-colors",
                    isSelected
                      ? "bg-sidebar-row-active font-medium text-sidebar-foreground"
                      : "text-sidebar-foreground hover:bg-sidebar-row-hover",
                  )}
                >
                  {project ? (
                    <ProjectFavicon project={project} className="size-4 shrink-0" />
                  ) : (
                    <BotIcon className="size-4 shrink-0 text-sidebar-muted-foreground" />
                  )}
                  <span className="min-w-0 flex-1 truncate">
                    {projectTitle}
                    {disambiguator ? (
                      <span className="ml-1.5 text-2xs font-normal text-sidebar-muted-foreground">
                        {disambiguator}
                      </span>
                    ) : null}
                  </span>
                  {isWorking ? (
                    <Spinner className="size-3 shrink-0" />
                  ) : needsAttention ? (
                    <span className="size-2 shrink-0 rounded-full bg-warning" aria-hidden />
                  ) : null}
                  {badgeText ? (
                    <span
                      className={cn(
                        "shrink-0 rounded px-1 font-mono text-3xs tabular-nums",
                        needsAttention
                          ? "bg-warning/15 text-warning"
                          : "text-sidebar-muted-foreground",
                      )}
                    >
                      {badgeText}
                    </span>
                  ) : null}
                </button>
                <div className="pr-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                  <Menu>
                    <MenuTrigger
                      render={
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          aria-label={gt("Orchestrator project actions")}
                        >
                          <MoreHorizontalIcon className="size-3.5" />
                        </Button>
                      }
                    />
                    <MenuPopup align="end">
                      <MenuItem onClick={() => void handleResetOrchestrator(thread, project)}>
                        <RotateCcwIcon className="size-3.5 shrink-0" />
                        <span>
                          <T>Start fresh chat</T>
                        </span>
                      </MenuItem>
                      <MenuItem onClick={() => void handleRemoveOrchestrator(thread)}>
                        <ArchiveIcon className="size-3.5 shrink-0" />
                        <span>
                          <T>Remove from Orchestrator</T>
                        </span>
                      </MenuItem>
                    </MenuPopup>
                  </Menu>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
