import {
  type OrchestrationV2AppThread,
  type OrchestrationV2OrchestratorTask,
  type OrchestrationV2OrchestratorTaskStatus,
  type OrchestrationV2Subagent,
  type OrchestrationV2ThreadShell,
  type ThreadId,
  type ThreadPullRequestLink,
  orchestratorTaskPrefixFromTitle,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { mFallback, msg } from "gt-i18n";

import { visibleThreadPullRequests } from "../threadPullRequests.ts";

export interface OrchestratorTaskBoardItem {
  readonly id: string;
  readonly key: string;
  readonly title: string;
  readonly parentTaskId: string | null;
  readonly status: OrchestrationV2OrchestratorTaskStatus;
  readonly persisted: boolean;
  readonly subagent: OrchestrationV2Subagent | null;
  readonly childThreadId: ThreadId | null;
  readonly childShell: OrchestrationV2ThreadShell | null;
  readonly modelLabel: string | null;
  readonly pullRequests: ReadonlyArray<ThreadPullRequestLink>;
  readonly hasPendingApproval: boolean;
  readonly hasPendingQuestion: boolean;
  readonly children: ReadonlyArray<OrchestratorTaskBoardItem>;
  readonly completedChildCount: number;
  readonly totalChildCount: number;
  readonly updatedAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
}

export interface OrchestratorTaskBoard {
  readonly needsAttention: ReadonlyArray<OrchestratorTaskBoardItem>;
  readonly inProgress: ReadonlyArray<OrchestratorTaskBoardItem>;
  readonly forReview: ReadonlyArray<OrchestratorTaskBoardItem>;
  readonly done: ReadonlyArray<OrchestratorTaskBoardItem>;
  readonly counts: {
    readonly needsAttention: number;
    readonly inProgress: number;
    readonly forReview: number;
    readonly done: number;
    readonly total: number;
  };
}

function isLiveSubagentStatus(status: OrchestrationV2Subagent["status"]): boolean {
  return status === "pending" || status === "running" || status === "waiting";
}

function liveStatusForTask(input: {
  readonly storedStatus: OrchestrationV2OrchestratorTaskStatus;
  readonly subagent: OrchestrationV2Subagent | null;
  readonly hasPendingApproval: boolean;
  readonly hasPendingQuestion: boolean;
}): OrchestrationV2OrchestratorTaskStatus {
  const { storedStatus, subagent, hasPendingApproval, hasPendingQuestion } = input;
  if (hasPendingApproval || hasPendingQuestion) return "needs_attention";
  if (subagent !== null) {
    if (isLiveSubagentStatus(subagent.status)) return "in_progress";
    if (subagent.status === "failed") {
      return storedStatus === "done" || storedStatus === "cancelled"
        ? storedStatus
        : "needs_attention";
    }
    if (subagent.status === "cancelled" || subagent.status === "interrupted") {
      return storedStatus === "done" || storedStatus === "for_review" ? storedStatus : "cancelled";
    }
    if (subagent.status === "completed") {
      return storedStatus === "done" ? "done" : "for_review";
    }
  }
  return storedStatus;
}

function subagentModelLabel(
  subagent: OrchestrationV2Subagent | null,
  childShell: OrchestrationV2ThreadShell | null,
): string | null {
  const raw =
    subagent?.executedModel ??
    subagent?.model ??
    subagent?.modelSelection?.model ??
    childShell?.modelSelection.model ??
    null;
  if (raw === null) return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function firstLineTitle(text: string): string {
  const line = text
    .split(/\r?\n/)
    .map((part) => part.trim())
    .find((part) => part.length > 0);
  return line ? line.slice(0, 120) : mFallback(msg("Delegated task"));
}

function toIsoString(value: DateTime.Utc | string | null | undefined): string | null {
  if (value == null) return null;
  return typeof value === "string" ? value : DateTime.formatIso(value);
}

/**
 * Merges persisted orchestrator tasks with live `app_owned` subagents and child shells
 * into grouped board sections (`needsAttention`, `inProgress`, `forReview`, `done`).
 */
export function deriveOrchestratorTaskBoard(input: {
  readonly thread: Pick<OrchestrationV2AppThread, "id" | "title" | "orchestratorTasks">;
  readonly subagents: ReadonlyArray<OrchestrationV2Subagent>;
  readonly getChildShell?: (threadId: ThreadId) => OrchestrationV2ThreadShell | null;
}): OrchestratorTaskBoard {
  const appSubagents = input.subagents.filter((subagent) => subagent.origin === "app_owned");
  const subagentById = new Map(appSubagents.map((subagent) => [subagent.id, subagent] as const));
  const persistedTasks = input.thread.orchestratorTasks ?? [];
  const linkedSubagentIds = new Set(
    persistedTasks.flatMap((task) => (task.subagentId === null ? [] : [task.subagentId])),
  );

  const prefix = orchestratorTaskPrefixFromTitle(input.thread.title);
  let maxKeyNumber = 0;
  for (const task of persistedTasks) {
    const match = /-(\d+)$/.exec(task.key);
    if (match?.[1]) {
      const parsed = Number.parseInt(match[1], 10);
      if (Number.isFinite(parsed) && parsed > maxKeyNumber) maxKeyNumber = parsed;
    }
  }

  interface RawRow {
    readonly id: string;
    readonly key: string;
    readonly title: string;
    readonly parentTaskId: string | null;
    readonly storedStatus: OrchestrationV2OrchestratorTaskStatus;
    readonly persisted: boolean;
    readonly subagent: OrchestrationV2Subagent | null;
    readonly childThreadId: ThreadId | null;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly completedAt: string | null;
  }

  const rawRows: Array<RawRow> = persistedTasks.map((task: OrchestrationV2OrchestratorTask) => {
    const subagent = task.subagentId === null ? null : (subagentById.get(task.subagentId) ?? null);
    return {
      id: task.id,
      key: task.key,
      title: task.title,
      parentTaskId: task.parentTaskId,
      storedStatus: task.status,
      persisted: true,
      subagent,
      childThreadId: task.childThreadId ?? subagent?.childThreadId ?? null,
      createdAt: task.createdAt,
      updatedAt: toIsoString(subagent?.updatedAt) ?? task.updatedAt,
      completedAt: toIsoString(subagent?.completedAt) ?? task.completedAt,
    };
  });

  // Synthesize rows for any app-owned subagents without an explicit task entry yet.
  for (const subagent of appSubagents) {
    if (linkedSubagentIds.has(subagent.id)) continue;
    maxKeyNumber += 1;
    rawRows.push({
      id: `subagent:${subagent.id}`,
      key: `${prefix}-${maxKeyNumber}`,
      title: subagent.title?.trim() || firstLineTitle(subagent.prompt),
      parentTaskId: null,
      storedStatus: "in_progress",
      persisted: false,
      subagent,
      childThreadId: subagent.childThreadId,
      createdAt: toIsoString(subagent.startedAt) ?? toIsoString(subagent.updatedAt) ?? "",
      updatedAt: toIsoString(subagent.updatedAt) ?? "",
      completedAt: toIsoString(subagent.completedAt),
    });
  }

  const flatById = new Map<string, OrchestratorTaskBoardItem>();
  for (const row of rawRows) {
    const childShell =
      row.childThreadId !== null && input.getChildShell
        ? input.getChildShell(row.childThreadId)
        : null;
    const pendingReq = childShell?.pendingRuntimeRequest ?? null;
    const hasPendingApproval = pendingReq !== null && pendingReq.kind !== "user_input";
    const hasPendingQuestion = pendingReq !== null && pendingReq.kind === "user_input";
    const status = liveStatusForTask({
      storedStatus: row.storedStatus,
      subagent: row.subagent,
      hasPendingApproval,
      hasPendingQuestion,
    });
    const pullRequests =
      childShell?.pullRequests !== undefined
        ? visibleThreadPullRequests(childShell.pullRequests)
        : [];
    flatById.set(row.id, {
      id: row.id,
      key: row.key,
      title: row.title,
      parentTaskId: row.parentTaskId,
      status,
      persisted: row.persisted,
      subagent: row.subagent,
      childThreadId: row.childThreadId,
      childShell,
      modelLabel: subagentModelLabel(row.subagent, childShell),
      pullRequests,
      hasPendingApproval,
      hasPendingQuestion,
      children: [],
      completedChildCount: 0,
      totalChildCount: 0,
      updatedAt: row.updatedAt,
      startedAt: toIsoString(row.subagent?.startedAt) ?? (row.createdAt || null),
      completedAt: row.completedAt,
    });
  }

  const childrenByParent = new Map<string, Array<OrchestratorTaskBoardItem>>();
  const roots: Array<OrchestratorTaskBoardItem> = [];
  for (const item of flatById.values()) {
    if (
      item.parentTaskId !== null &&
      item.parentTaskId !== item.id &&
      flatById.has(item.parentTaskId)
    ) {
      const siblings = childrenByParent.get(item.parentTaskId) ?? [];
      siblings.push(item);
      childrenByParent.set(item.parentTaskId, siblings);
    } else {
      roots.push(item);
    }
  }

  const hydrateTree = (item: OrchestratorTaskBoardItem): OrchestratorTaskBoardItem => {
    const rawChildren = (childrenByParent.get(item.id) ?? []).map(hydrateTree);
    if (rawChildren.length === 0) return item;
    const completedChildCount = rawChildren.filter(
      (child) => child.status === "done" || child.status === "for_review",
    ).length;
    let derivedStatus = item.status;
    if (rawChildren.some((child) => child.status === "needs_attention")) {
      derivedStatus = "needs_attention";
    } else if (rawChildren.some((child) => child.status === "in_progress")) {
      derivedStatus = "in_progress";
    } else if (
      item.status !== "done" &&
      rawChildren.some((child) => child.status === "for_review")
    ) {
      derivedStatus = "for_review";
    }
    return {
      ...item,
      status: derivedStatus,
      children: rawChildren,
      completedChildCount,
      totalChildCount: rawChildren.length,
    };
  };

  const hydratedRoots = roots
    .map(hydrateTree)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

  const needsAttention: Array<OrchestratorTaskBoardItem> = [];
  const inProgress: Array<OrchestratorTaskBoardItem> = [];
  const forReview: Array<OrchestratorTaskBoardItem> = [];
  const done: Array<OrchestratorTaskBoardItem> = [];

  for (const item of hydratedRoots) {
    switch (item.status) {
      case "needs_attention":
        needsAttention.push(item);
        break;
      case "in_progress":
      case "planned":
        inProgress.push(item);
        break;
      case "for_review":
        forReview.push(item);
        break;
      case "done":
      case "cancelled":
        done.push(item);
        break;
    }
  }

  return {
    needsAttention,
    inProgress,
    forReview,
    done,
    counts: {
      needsAttention: needsAttention.length,
      inProgress: inProgress.length,
      forReview: forReview.length,
      done: done.length,
      total: hydratedRoots.length,
    },
  };
}
