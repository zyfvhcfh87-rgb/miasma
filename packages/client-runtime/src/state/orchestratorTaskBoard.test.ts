import {
  NodeId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2OrchestratorTask,
  type OrchestrationV2Subagent,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { deriveOrchestratorTaskBoard } from "./orchestratorTaskBoard.ts";

const NOW = DateTime.makeUnsafe("2026-11-25T18:00:00.000Z");

function makeSubagent(overrides: Partial<OrchestrationV2Subagent> = {}): OrchestrationV2Subagent {
  return {
    id: NodeId.make("sub-1"),
    threadId: ThreadId.make("orch-1"),
    runId: null,
    parentNodeId: NodeId.make("root-1"),
    origin: "app_owned",
    createdBy: "agent",
    driver: ProviderDriverKind.make("opencode"),
    providerInstanceId: ProviderInstanceId.make("opencode"),
    providerThreadId: null,
    childThreadId: ThreadId.make("child-1"),
    nativeTaskRef: null,
    prompt: "Implement top bar",
    title: "Refresh the Coss top bar",
    model: "mistral/devstral",
    status: "running",
    result: null,
    startedAt: NOW,
    completedAt: null,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeTask(
  overrides: Partial<OrchestrationV2OrchestratorTask> = {},
): OrchestrationV2OrchestratorTask {
  return {
    id: "task-1",
    key: "STO-1",
    title: "Design library theme sets",
    parentTaskId: null,
    status: "planned",
    subagentId: null,
    childThreadId: null,
    createdAt: "2026-11-25T17:00:00.000Z",
    updatedAt: "2026-11-25T17:30:00.000Z",
    completedAt: null,
    ...overrides,
  };
}

describe("deriveOrchestratorTaskBoard", () => {
  it("groups parent and child tasks with live subagent statuses and counts", () => {
    const parent = makeTask({
      id: "task-parent",
      key: "STO-19",
      title: "Design library theme sets",
      status: "in_progress",
    });
    const childDone = makeTask({
      id: "task-c1",
      key: "STO-20",
      title: "Design four Ant Design layouts",
      parentTaskId: "task-parent",
      status: "done",
      subagentId: NodeId.make("sub-done"),
      childThreadId: ThreadId.make("child-done"),
    });
    const childReview = makeTask({
      id: "task-c2",
      key: "STO-21",
      title: "Design four AlignUI layouts",
      parentTaskId: "task-parent",
      status: "in_progress",
      subagentId: NodeId.make("sub-review"),
      childThreadId: ThreadId.make("child-review"),
    });
    const standaloneRunning = makeSubagent({
      id: NodeId.make("sub-running"),
      title: "Speed up disk scan",
      status: "running",
    });
    const standaloneFailed = makeSubagent({
      id: NodeId.make("sub-failed"),
      title: "Fix treemap hover glow",
      status: "failed",
    });

    const board = deriveOrchestratorTaskBoard({
      thread: {
        id: ThreadId.make("orch-1"),
        title: "StorageViewer",
        orchestratorTasks: [parent, childDone, childReview],
      },
      subagents: [
        makeSubagent({ id: NodeId.make("sub-done"), status: "completed" }),
        makeSubagent({ id: NodeId.make("sub-review"), status: "completed" }),
        standaloneRunning,
        standaloneFailed,
      ],
    });

    expect(board.needsAttention.map((item) => item.title)).toEqual(["Fix treemap hover glow"]);
    expect(board.inProgress.map((item) => item.title)).toEqual(["Speed up disk scan"]);
    expect(board.forReview.map((item) => item.key)).toEqual(["STO-19"]);
    expect(board.forReview[0]?.totalChildCount).toBe(2);
    expect(board.forReview[0]?.completedChildCount).toBe(2);
    expect(board.forReview[0]?.children.map((c) => c.key)).toEqual(["STO-20", "STO-21"]);
    expect(board.counts.total).toBe(3);
  });

  it("ignores provider-native subagents and respects explicit done status", () => {
    const doneTask = makeTask({
      id: "task-done",
      key: "STO-5",
      title: "Merge treemap hover",
      status: "done",
      subagentId: NodeId.make("sub-1"),
    });
    const board = deriveOrchestratorTaskBoard({
      thread: {
        id: ThreadId.make("orch-1"),
        title: "StorageViewer",
        orchestratorTasks: [doneTask],
      },
      subagents: [
        makeSubagent({ id: NodeId.make("sub-1"), status: "completed" }),
        makeSubagent({
          id: NodeId.make("sub-native"),
          origin: "provider_native",
          status: "running",
        }),
      ],
    });

    expect(board.done).toHaveLength(1);
    expect(board.inProgress).toHaveLength(0);
    expect(board.forReview).toHaveLength(0);
  });

  it("keeps a failed subagent task in For Review when explicitly moved to for_review", () => {
    const failedReopened = makeTask({
      id: "task-failed-reopened",
      key: "STO-9",
      title: "Inspect flaky test failure",
      status: "for_review",
      subagentId: NodeId.make("sub-failed"),
    });
    const board = deriveOrchestratorTaskBoard({
      thread: {
        id: ThreadId.make("orch-1"),
        title: "StorageViewer",
        orchestratorTasks: [failedReopened],
      },
      subagents: [makeSubagent({ id: NodeId.make("sub-failed"), status: "failed" })],
    });

    expect(board.forReview.map((item) => item.id)).toEqual(["task-failed-reopened"]);
    expect(board.needsAttention).toHaveLength(0);
  });
});
