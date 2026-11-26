import { assert, describe, it } from "@effect/vitest";
import {
  CommandId,
  EventId,
  NodeId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderThreadId,
  ThreadId,
  isListedThreadLineage,
  isOrchestratorThreadLineage,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import {
  buildCoordinatorOrchestratorInstructions,
  buildCoordinatorOrchestratorSections,
  t3AcpPromptWithInstructions,
} from "@t3tools/provider-core/server/orchestrationInstructions";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as Effect from "effect/Effect";

import * as McpToolExposure from "../mcp/McpToolExposure.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import * as EventSink from "./EventSink.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import * as ProviderReplayHarness from "./testkit/ProviderReplayHarness.ts";

const instanceId = ProviderInstanceId.make("codex");
const stubAdapter = {
  instanceId,
  driver: ProviderDriverKind.make("codex"),
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
  openSession: () => Effect.die("No provider process needed for coordinator metadata tests"),
} as ProviderAdapter.ProviderAdapterV2["Service"];

const layerDatabase = SqlitePersistence.layerMemory;
const layerOrchestratorTest = ProviderReplayHarness.layerWithRegistry(
  { name: "coordinator-orchestrator" },
  ProviderAdapterRegistry.layerFromAdapters([stubAdapter]),
  { databaseLayer: layerDatabase, runEffectWorker: false },
);

describe("Coordinator Orchestrator", () => {
  it.effect(
    "creates an orchestrator thread, persists worker policy, and tracks task board counts in the shell",
    () =>
      Effect.gen(function* () {
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        const threadId = ThreadId.make("thread:coordinator-1");
        const projectId = ProjectId.make("project:storage-viewer");

        yield* orchestrator.dispatch({
          type: "thread.create",
          commandId: CommandId.make("cmd:orch-create"),
          createdBy: "user",
          creationSource: "web",
          threadId,
          projectId,
          title: "StorageViewer",
          modelSelection: {
            instanceId,
            model: "gpt-5.4",
          },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          orchestrator: true,
          orchestratorWorkerPolicy: { mode: "auto" },
        });

        const created = yield* orchestrator.getThreadProjection(threadId);
        assert.isTrue(isOrchestratorThreadLineage(created.thread.lineage));
        assert.isTrue(isListedThreadLineage(created.thread.lineage));
        assert.deepStrictEqual(created.thread.orchestratorWorkerPolicy, { mode: "auto" });

        // Switch to manual worker model policy.
        yield* orchestrator.dispatch({
          type: "thread.orchestrator-worker-policy.set",
          commandId: CommandId.make("cmd:orch-policy"),
          threadId,
          workerPolicy: {
            mode: "manual",
            modelSelection: {
              instanceId: ProviderInstanceId.make("claudeAgent"),
              model: "claude-sonnet-4-6",
            },
          },
        });

        // Upsert parent task and child task linked to a subagent.
        const parentTaskId = "task:parent-theme";
        const childTaskId = "task:child-coss";
        yield* orchestrator.dispatch({
          type: "thread.orchestrator-task.upsert",
          commandId: CommandId.make("cmd:orch-task-1"),
          threadId,
          taskId: parentTaskId,
          title: "Design library theme sets",
          status: "in_progress",
        });
        yield* orchestrator.dispatch({
          type: "thread.orchestrator-task.upsert",
          commandId: CommandId.make("cmd:orch-task-2"),
          threadId,
          taskId: childTaskId,
          title: "Design four Coss layouts",
          parentTaskId,
          subagentId: NodeId.make("node:subagent-1"),
          childThreadId: ThreadId.make("thread:child-1"),
          status: "for_review",
        });

        // Move child task to done and verify persisted counts on the shell.
        yield* orchestrator.dispatch({
          type: "thread.orchestrator-task.set-status",
          commandId: CommandId.make("cmd:orch-task-done"),
          threadId,
          taskId: childTaskId,
          status: "done",
        });

        const afterDone = yield* orchestrator.getThreadProjection(threadId);
        assert.deepStrictEqual(afterDone.thread.orchestratorWorkerPolicy, {
          mode: "manual",
          modelSelection: {
            instanceId: ProviderInstanceId.make("claudeAgent"),
            model: "claude-sonnet-4-6",
          },
        });
        assert.strictEqual(afterDone.thread.orchestratorTasks?.length, 2);
        assert.strictEqual(afterDone.thread.orchestratorTasks?.[0]?.key, "STO-1");
        assert.strictEqual(afterDone.thread.orchestratorTasks?.[1]?.key, "STO-2");
        assert.strictEqual(afterDone.thread.orchestratorTasks?.[1]?.status, "done");
        assert.isNotNull(afterDone.thread.orchestratorTasks?.[1]?.completedAt);

        const shell = yield* orchestrator.getThreadShell(threadId);
        assert.isNotNull(shell);
        assert.strictEqual(shell?.lineage.orchestrator, true);
        assert.deepStrictEqual(shell?.orchestratorWorkerPolicy, {
          mode: "manual",
          modelSelection: {
            instanceId: ProviderInstanceId.make("claudeAgent"),
            model: "claude-sonnet-4-6",
          },
        });
        assert.deepStrictEqual(shell?.orchestratorTaskCounts, {
          needsAttention: 0,
          inProgress: 1,
          forReview: 0,
          done: 1,
        });

        // Reopen task back to for_review.
        yield* orchestrator.dispatch({
          type: "thread.orchestrator-task.set-status",
          commandId: CommandId.make("cmd:orch-task-reopen"),
          threadId,
          taskId: childTaskId,
          status: "for_review",
        });
        const shellAfterReopen = yield* orchestrator.getThreadShell(threadId);
        assert.deepStrictEqual(shellAfterReopen?.orchestratorTaskCounts, {
          needsAttention: 0,
          inProgress: 1,
          forReview: 1,
          done: 0,
        });
      }).pipe(Effect.provide(layerOrchestratorTest)),
  );

  it.effect(
    "preserves concurrent activeProviderThreadId when syncing linked orchestrator tasks",
    () =>
      Effect.gen(function* () {
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        const sink = yield* EventSink.EventSinkV2;
        const threadId = ThreadId.make("thread:coordinator-race");
        const projectId = ProjectId.make("project:race");
        const subagentId = NodeId.make("node:subagent-race");
        const providerThreadId = ProviderThreadId.make("provider-thread:live-1");

        yield* orchestrator.dispatch({
          type: "thread.create",
          commandId: CommandId.make("cmd:race-create"),
          createdBy: "user",
          creationSource: "web",
          threadId,
          projectId,
          title: "RaceProject",
          modelSelection: { instanceId, model: "gpt-5.4" },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          orchestrator: true,
          orchestratorWorkerPolicy: { mode: "auto" },
        });
        yield* orchestrator.dispatch({
          type: "thread.orchestrator-task.upsert",
          commandId: CommandId.make("cmd:race-task"),
          threadId,
          taskId: "task:race-1",
          title: "Build race-free sync",
          subagentId,
          status: "in_progress",
        });

        const now = yield* DateTime.now;
        yield* sink.write({
          commandId: CommandId.make("cmd:race-provider-thread"),
          events: [
            {
              id: EventId.make("evt:race-provider-thread"),
              type: "provider-thread.updated",
              threadId,
              driver: ProviderDriverKind.make("codex"),
              providerInstanceId: instanceId,
              occurredAt: now,
              payload: {
                id: providerThreadId,
                appThreadId: threadId,
                ownerNodeId: NodeId.make("node:root-race"),
                driver: ProviderDriverKind.make("codex"),
                providerInstanceId: instanceId,
                providerSessionId: null,
                nativeThreadRef: {
                  driver: ProviderDriverKind.make("codex"),
                  nativeId: "native-live-1",
                  strength: "strong",
                },
                nativeConversationHeadRef: null,
                status: "active",
                firstRunOrdinal: 1,
                lastRunOrdinal: 1,
                handoffIds: [],
                forkedFrom: null,
                createdAt: now,
                updatedAt: now,
              },
            },
          ],
        });
        yield* sink.write({
          commandId: CommandId.make("cmd:race-task-sync"),
          events: [
            {
              id: EventId.make("evt:race-task-sync"),
              type: "thread.orchestrator-tasks-updated",
              threadId,
              occurredAt: now,
              payload: {
                kind: "sync_subagent",
                subagentId,
                status: "for_review",
              },
            },
          ],
        });

        const updated = yield* orchestrator.getThreadProjection(threadId);
        assert.strictEqual(updated.thread.activeProviderThreadId, providerThreadId);
        assert.strictEqual(updated.thread.orchestratorTasks?.[0]?.status, "for_review");
      }).pipe(Effect.provide(layerOrchestratorTest)),
  );

  it("exposes orchestrator MCP tools directly only for orchestrator sessions", () => {
    const exposure = McpToolExposure.make(
      () => [],
      () => Effect.void,
    );
    assert.isFalse(exposure.isListed("sess-normal", "t3_task_board", { orchestrator: false }));
    assert.isFalse(exposure.isListed("sess-normal", "t3_thread_send", { orchestrator: false }));
    assert.isTrue(exposure.isListed("sess-orch", "t3_task_board", { orchestrator: true }));
    assert.isTrue(exposure.isListed("sess-orch", "t3_thread_send", { orchestrator: true }));
    assert.isTrue(exposure.isListed("sess-orch", "t3_pending_request", { orchestrator: true }));
    assert.isTrue(exposure.isListed("sess-orch", "task_cancel", { orchestrator: true }));
  });

  it("builds concise coordinator instructions reflecting Auto and Manual worker policies", () => {
    const encoder = new TextEncoder();
    const autoSections = buildCoordinatorOrchestratorSections({
      workerPolicy: { mode: "auto" },
    });
    for (const section of autoSections) {
      assert.isBelow(encoder.encode(section).length, 4_000);
    }
    const autoText = buildCoordinatorOrchestratorInstructions({
      workerPolicy: { mode: "auto" },
    });
    assert.include(autoText, "Never code directly");
    assert.include(autoText, "Worker model mode is **Auto**");

    const manualText = buildCoordinatorOrchestratorInstructions({
      workerPolicy: {
        mode: "manual",
        modelSelection: {
          instanceId: ProviderInstanceId.make("grok"),
          model: "grok-4.7",
        },
      },
    });
    assert.include(manualText, "Worker model mode is **Manual**");
    assert.include(manualText, "grok-4.7");

    // Verify follow-up turns in ACP skip re-injecting identical coordinator instructions without crashing.
    const acpState = {
      interactionMode: "default" as const,
      hasT3Mcp: true,
      hasDeviceTools: false,
      orchestrator: { workerPolicy: { mode: "auto" as const } },
    };
    const firstTurn = t3AcpPromptWithInstructions({ prompt: "Plan it", state: acpState });
    assert.include(firstTurn, "Miasma Project Orchestrator");
    const secondTurn = t3AcpPromptWithInstructions({
      prompt: "Worker finished",
      state: acpState,
      previousState: acpState,
    });
    assert.strictEqual(secondTurn, "Worker finished");
  });
});
