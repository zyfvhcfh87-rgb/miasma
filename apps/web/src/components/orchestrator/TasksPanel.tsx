import {
  deriveOrchestratorTaskBoard,
  type OrchestratorTaskBoardItem,
} from "@t3tools/client-runtime/state/orchestrator-task-board";
import {
  AuthOrchestrationOperateScope,
  type OrchestrationV2OrchestratorTaskStatus,
  type ScopedThreadRef,
  type ThreadId,
} from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import {
  AlertCircleIcon,
  BotIcon,
  CheckCircle2Icon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleDashedIcon,
  ListTodoIcon,
  RotateCcwIcon,
  SearchIcon,
  SquareIcon,
  XIcon,
} from "lucide-react";
import { useState } from "react";

import { useProjects, useQuietThreadProjection, useThreadShells } from "../../state/entities";
import { useEnvironmentScope } from "../../state/session";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { useRightPanelStore } from "../../rightPanelStore";
import { cn } from "../../lib/utils";
import { ProjectFavicon } from "../ProjectFavicon";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { AgentElapsed } from "../chat/AgentElapsed";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

function matchesTaskQuery(item: OrchestratorTaskBoardItem, normalizedQuery: string): boolean {
  if (normalizedQuery.length === 0) return true;
  if (
    item.title.toLowerCase().includes(normalizedQuery) ||
    item.key.toLowerCase().includes(normalizedQuery) ||
    (item.modelLabel?.toLowerCase().includes(normalizedQuery) ?? false)
  ) {
    return true;
  }
  return item.children.some((child) => matchesTaskQuery(child, normalizedQuery));
}

function shortModelLabel(model: string): string {
  const slashIndex = model.lastIndexOf("/");
  return slashIndex >= 0 && slashIndex < model.length - 1 ? model.slice(slashIndex + 1) : model;
}

function TaskStatusGlyph({ status }: { status: OrchestratorTaskBoardItem["status"] }) {
  switch (status) {
    case "needs_attention":
      return <AlertCircleIcon className="size-3.5 shrink-0 text-warning" />;
    case "in_progress":
      return <Spinner className="size-3.5 shrink-0" />;
    case "for_review":
      return <CircleDashedIcon className="size-3.5 shrink-0 text-foreground/75" />;
    case "done":
      return <CheckCircle2Icon className="size-3.5 shrink-0 text-success" />;
    case "cancelled":
      return <XIcon className="size-3.5 shrink-0 text-muted-foreground" />;
    case "planned":
      return <CircleDashedIcon className="size-3.5 shrink-0 text-muted-foreground" />;
  }
}

function TaskRow({
  item,
  depth,
  canOperate,
  onOpenChildThread,
  onOpenPullRequest,
  onSetStatus,
  onCancelSubagent,
}: {
  item: OrchestratorTaskBoardItem;
  depth: number;
  canOperate: boolean;
  onOpenChildThread: (childThreadId: ThreadId) => void;
  onOpenPullRequest: (pr: OrchestratorTaskBoardItem["pullRequests"][number]) => void;
  onSetStatus: (
    item: OrchestratorTaskBoardItem,
    status: OrchestrationV2OrchestratorTaskStatus,
  ) => void;
  onCancelSubagent: (item: OrchestratorTaskBoardItem) => void;
}) {
  const gt = useGT();
  const [expanded, setExpanded] = useState(true);
  const hasChildren = item.children.length > 0;
  const clickable = item.childThreadId !== null;
  const isRunning = item.status === "in_progress";
  const isDone = item.status === "done" || item.status === "cancelled";

  return (
    <div className="flex flex-col">
      <div
        className={cn(
          "group flex min-h-8 items-center gap-2 rounded-md px-2 py-1 text-xs transition-colors hover:bg-accent/60",
          depth > 0 && "ml-5 border-l border-border/60 pl-2.5",
        )}
      >
        {hasChildren ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={expanded ? gt("Collapse subtasks") : gt("Expand subtasks")}
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? (
              <ChevronDownIcon className="size-3" />
            ) : (
              <ChevronRightIcon className="size-3" />
            )}
          </Button>
        ) : null}

        <TaskStatusGlyph status={item.status} />

        <button
          type="button"
          disabled={!clickable}
          onClick={() => {
            if (item.childThreadId !== null) onOpenChildThread(item.childThreadId);
          }}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
            clickable ? "cursor-pointer" : "cursor-default",
          )}
        >
          <span className="shrink-0 font-mono text-2xs text-muted-foreground">{item.key}</span>
          <span
            className={cn(
              "min-w-0 truncate font-medium",
              isDone ? "text-muted-foreground" : "text-foreground",
            )}
          >
            {item.title}
          </span>
          {item.totalChildCount > 0 ? (
            <Badge variant="outline" size="sm">
              {gt("{completed} of {total}", {
                completed: item.completedChildCount,
                total: item.totalChildCount,
              })}
            </Badge>
          ) : null}
        </button>

        <div className="flex shrink-0 items-center gap-1">
          {isRunning && item.startedAt ? (
            <span className="font-mono text-2xs text-muted-foreground tabular-nums">
              <AgentElapsed
                agent={{ status: "running", startedAt: item.startedAt, completedAt: null }}
                compact
              />
            </span>
          ) : null}

          {item.modelLabel ? (
            <Badge variant="secondary" size="sm">
              <BotIcon className="size-3" />
              <span className="max-w-24 truncate">{shortModelLabel(item.modelLabel)}</span>
            </Badge>
          ) : null}

          {item.pullRequests.slice(0, 2).map((pr) => (
            <Button
              key={`${pr.repository}#${pr.number}`}
              type="button"
              variant="outline"
              size="xs"
              onClick={() => onOpenPullRequest(pr)}
            >
              <PullRequestGlyph.pullRequest className="size-3" />
              <span>#{pr.number}</span>
            </Button>
          ))}

          {item.hasPendingApproval ? (
            <Badge variant="warning" size="sm">
              <T>Approval</T>
            </Badge>
          ) : item.hasPendingQuestion ? (
            <Badge variant="info" size="sm">
              <T>Question</T>
            </Badge>
          ) : null}

          {canOperate && isRunning && item.subagent !== null ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={gt("Stop task")}
                    onClick={() => onCancelSubagent(item)}
                  >
                    <SquareIcon className="size-3" />
                  </Button>
                }
              />
              <TooltipPopup side="left">
                <T>Stop task</T>
              </TooltipPopup>
            </Tooltip>
          ) : null}

          {canOperate && !isRunning && !isDone ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={gt("Mark task done")}
                    onClick={() => onSetStatus(item, "done")}
                  >
                    <CheckIcon className="size-3" />
                  </Button>
                }
              />
              <TooltipPopup side="left">
                <T>Mark done</T>
              </TooltipPopup>
            </Tooltip>
          ) : null}

          {canOperate && isDone ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={gt("Reopen task for review")}
                    onClick={() => onSetStatus(item, "for_review")}
                  >
                    <RotateCcwIcon className="size-3" />
                  </Button>
                }
              />
              <TooltipPopup side="left">
                <T>Move to For Review</T>
              </TooltipPopup>
            </Tooltip>
          ) : null}
        </div>
      </div>

      {item.subagent?.progress && isRunning ? (
        <p
          className={cn(
            "truncate px-2 pb-1 text-2xs text-muted-foreground",
            depth > 0 ? "ml-10" : "ml-6",
          )}
        >
          {item.subagent.progress}
        </p>
      ) : null}

      {hasChildren && expanded ? (
        <div className="flex flex-col gap-0.5 py-0.5">
          {item.children.map((child) => (
            <TaskRow
              key={child.id}
              item={child}
              depth={depth + 1}
              canOperate={canOperate}
              onOpenChildThread={onOpenChildThread}
              onOpenPullRequest={onOpenPullRequest}
              onSetStatus={onSetStatus}
              onCancelSubagent={onCancelSubagent}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function TaskSection({
  title,
  count,
  defaultOpen,
  tone,
  items,
  canOperate,
  onOpenChildThread,
  onOpenPullRequest,
  onSetStatus,
  onCancelSubagent,
}: {
  title: string;
  count: number;
  defaultOpen: boolean;
  tone?: "warning" | "info" | "default" | "muted";
  items: ReadonlyArray<OrchestratorTaskBoardItem>;
  canOperate: boolean;
  onOpenChildThread: (childThreadId: ThreadId) => void;
  onOpenPullRequest: (pr: OrchestratorTaskBoardItem["pullRequests"][number]) => void;
  onSetStatus: (
    item: OrchestratorTaskBoardItem,
    status: OrchestrationV2OrchestratorTaskStatus,
  ) => void;
  onCancelSubagent: (item: OrchestratorTaskBoardItem) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (count === 0) return null;

  return (
    <section className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex h-7 items-center gap-1.5 rounded-md px-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
      >
        {open ? (
          <ChevronDownIcon className="size-3.5 shrink-0" />
        ) : (
          <ChevronRightIcon className="size-3.5 shrink-0" />
        )}
        <span
          className={cn(
            tone === "warning" && "text-warning",
            tone === "info" && "text-info",
            tone === "default" && "text-foreground",
          )}
        >
          {title}
        </span>
        <span className="font-mono text-2xs text-muted-foreground/80 tabular-nums">{count}</span>
      </button>
      {open ? (
        <div className="flex flex-col gap-0.5 pl-1">
          {items.map((item) => (
            <TaskRow
              key={item.id}
              item={item}
              depth={0}
              canOperate={canOperate}
              onOpenChildThread={onOpenChildThread}
              onOpenPullRequest={onOpenPullRequest}
              onSetStatus={onSetStatus}
              onCancelSubagent={onCancelSubagent}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function TasksPanel({ threadRef }: { threadRef: ScopedThreadRef }) {
  const gt = useGT();
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const projection = useQuietThreadProjection(threadRef)?.projection ?? null;
  const projects = useProjects();
  const allShells = useThreadShells();
  const canOperate = useEnvironmentScope(threadRef.environmentId, AuthOrchestrationOperateScope);
  const setTaskStatus = useAtomCommand(threadEnvironment.setOrchestratorTaskStatus, {
    reportFailure: false,
  });
  const upsertTask = useAtomCommand(threadEnvironment.upsertOrchestratorTask, {
    reportFailure: false,
  });
  const interruptTurn = useAtomCommand(threadEnvironment.interruptTurn, { reportFailure: false });

  const project =
    projection === null
      ? null
      : (projects.find(
          (candidate) =>
            candidate.environmentId === threadRef.environmentId &&
            candidate.id === projection.thread.projectId,
        ) ?? null);

  const shellsByThreadId = new Map(
    allShells
      .filter((shell) => shell.environmentId === threadRef.environmentId)
      .map((shell) => [shell.id, shell] as const),
  );

  const board =
    projection === null
      ? null
      : deriveOrchestratorTaskBoard({
          thread: projection.thread,
          subagents: projection.subagents,
          getChildShell: (childThreadId) => shellsByThreadId.get(childThreadId)?.source ?? null,
        });

  const normalizedQuery = query.trim().toLowerCase();
  const filterItems = (items: ReadonlyArray<OrchestratorTaskBoardItem>) =>
    normalizedQuery.length === 0
      ? items
      : items.filter((item) => matchesTaskQuery(item, normalizedQuery));

  const needsAttention = board ? filterItems(board.needsAttention) : [];
  const inProgress = board ? filterItems(board.inProgress) : [];
  const forReview = board ? filterItems(board.forReview) : [];
  const done = board ? filterItems(board.done) : [];

  const handleOpenChildThread = (childThreadId: ThreadId) => {
    useRightPanelStore.getState().openThread(threadRef, childThreadId);
  };

  const handleOpenPullRequest = (pr: OrchestratorTaskBoardItem["pullRequests"][number]) => {
    if (!projection) return;
    useRightPanelStore.getState().openPullRequest(threadRef, {
      projectId: projection.thread.projectId,
      repository: pr.repository,
      number: pr.number,
      ...(pr.host ? { host: pr.host } : {}),
      ...(pr.url ? { url: pr.url } : {}),
    });
  };

  const handleSetStatus = (
    item: OrchestratorTaskBoardItem,
    status: OrchestrationV2OrchestratorTaskStatus,
  ) => {
    if (!canOperate) return;
    if (item.persisted) {
      void setTaskStatus({
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId, taskId: item.id, status },
      });
      return;
    }
    void upsertTask({
      environmentId: threadRef.environmentId,
      input: {
        threadId: threadRef.threadId,
        title: item.title,
        status,
        subagentId: item.subagent?.id ?? null,
        childThreadId: item.childThreadId,
      },
    });
  };

  const handleCancelSubagent = (item: OrchestratorTaskBoardItem) => {
    if (!canOperate || item.childThreadId === null) return;
    void interruptTurn({
      environmentId: threadRef.environmentId,
      input: {
        threadId: item.childThreadId,
      },
    });
  };

  const totalVisible = needsAttention.length + inProgress.length + forReview.length + done.length;

  return (
    <div
      className="flex h-full min-h-0 flex-col bg-background"
      data-testid="orchestrator-tasks-panel"
    >
      <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
        <div className="flex min-w-0 items-center gap-2">
          {project ? (
            <ProjectFavicon project={project} className="size-4 shrink-0" />
          ) : (
            <ListTodoIcon className="size-4 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate text-sm font-medium">
            {project?.title ?? projection?.thread.title ?? gt("Tasks")}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {searchOpen ? (
            <div className="flex h-7 items-center gap-1 rounded-md border border-border bg-muted/40 px-2">
              <SearchIcon className="size-3 text-muted-foreground" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                placeholder={gt("Filter tasks...")}
                aria-label={gt("Filter tasks")}
                className="w-32 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                autoFocus
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={gt("Close task filter")}
                onClick={() => {
                  setQuery("");
                  setSearchOpen(false);
                }}
              >
                <XIcon className="size-3" />
              </Button>
            </div>
          ) : (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={gt("Filter tasks")}
                    onClick={() => setSearchOpen(true)}
                  >
                    <SearchIcon className="size-3.5" />
                  </Button>
                }
              />
              <TooltipPopup side="bottom">
                <T>Filter tasks</T>
              </TooltipPopup>
            </Tooltip>
          )}
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-3 p-3">
          {board === null || totalVisible === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
              <ListTodoIcon className="size-7 text-muted-foreground/40" />
              <p className="text-sm font-medium text-foreground/80">
                {normalizedQuery.length > 0 ? <T>No matching tasks</T> : <T>No tasks yet</T>}
              </p>
              <p className="max-w-64 text-xs text-muted-foreground">
                {normalizedQuery.length > 0 ? (
                  <T>Try a different search term.</T>
                ) : (
                  <T>
                    Ask the orchestrator to build, fix, or investigate something. Every delegated
                    sub-agent task will appear here.
                  </T>
                )}
              </p>
            </div>
          ) : (
            <>
              <TaskSection
                title={gt("Needs Attention")}
                count={needsAttention.length}
                defaultOpen
                tone="warning"
                items={needsAttention}
                canOperate={canOperate}
                onOpenChildThread={handleOpenChildThread}
                onOpenPullRequest={handleOpenPullRequest}
                onSetStatus={handleSetStatus}
                onCancelSubagent={handleCancelSubagent}
              />
              <TaskSection
                title={gt("In Progress")}
                count={inProgress.length}
                defaultOpen
                tone="info"
                items={inProgress}
                canOperate={canOperate}
                onOpenChildThread={handleOpenChildThread}
                onOpenPullRequest={handleOpenPullRequest}
                onSetStatus={handleSetStatus}
                onCancelSubagent={handleCancelSubagent}
              />
              <TaskSection
                title={gt("For Review")}
                count={forReview.length}
                defaultOpen
                tone="default"
                items={forReview}
                canOperate={canOperate}
                onOpenChildThread={handleOpenChildThread}
                onOpenPullRequest={handleOpenPullRequest}
                onSetStatus={handleSetStatus}
                onCancelSubagent={handleCancelSubagent}
              />
              <TaskSection
                title={gt("Done")}
                count={done.length}
                defaultOpen={
                  needsAttention.length === 0 && inProgress.length === 0 && forReview.length === 0
                }
                tone="muted"
                items={done}
                canOperate={canOperate}
                onOpenChildThread={handleOpenChildThread}
                onOpenPullRequest={handleOpenPullRequest}
                onSetStatus={handleSetStatus}
                onCancelSubagent={handleCancelSubagent}
              />
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
