import {
  deriveOrchestratorTaskBoard,
  type OrchestratorTaskBoardItem,
} from "@t3tools/client-runtime/state/orchestrator-task-board";
import type {
  EnvironmentId,
  OrchestrationV2OrchestratorTaskStatus,
  ThreadId,
} from "@t3tools/contracts";
import { StackActions, useNavigation, type StaticScreenProps } from "@react-navigation/native";
import * as Option from "effect/Option";
import * as Haptics from "expo-haptics";
import { T, useGT } from "gt-react-native";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/ui/AppText";
import { ScreenContent } from "../../components/ui/ScreenContent";
import { SheetHeader } from "../../components/ui/SheetHeader";
import { useThreadShells } from "../../state/entities";
import { threadEnvironment, useEnvironmentThread } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { useOpenThreadInspector } from "./thread-inspector-navigation";

type TasksTarget = { readonly environmentId: EnvironmentId; readonly threadId: ThreadId };

function groupHeading(gt: ReturnType<typeof useGT>, status: OrchestrationV2OrchestratorTaskStatus) {
  switch (status) {
    case "needs_attention":
      return gt("Needs Attention");
    case "in_progress":
      return gt("In Progress");
    case "for_review":
      return gt("For Review");
    case "done":
      return gt("Done");
    case "cancelled":
      return gt("Cancelled");
  }
}

export function ThreadTasksSheet({ route }: StaticScreenProps<TasksTarget>) {
  const target = route.params;
  const navigation = useNavigation();
  const openInspector = useOpenThreadInspector();
  const insets = useSafeAreaInsets();
  const gt = useGT();
  const threadState = useEnvironmentThread(target.environmentId, target.threadId);
  const projection = Option.getOrNull(threadState.data);
  const shells = useThreadShells();
  const setTaskStatus = useAtomCommand(threadEnvironment.setOrchestratorTaskStatus, {
    reportFailure: false,
  });
  const upsertTask = useAtomCommand(threadEnvironment.upsertOrchestratorTask, {
    reportFailure: false,
  });

  const shellsByThreadId = new Map(
    shells
      .filter((shell) => shell.environmentId === target.environmentId)
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

  const openChildThread = (childThreadId: ThreadId) => {
    void Haptics.selectionAsync();
    if (
      openInspector(target, {
        type: "thread",
        environmentId: target.environmentId,
        threadId: childThreadId,
      })
    ) {
      return;
    }
    navigation.dispatch(
      StackActions.replace("Thread", {
        environmentId: target.environmentId,
        threadId: childThreadId,
      }),
    );
  };

  const handleToggleDone = (item: OrchestratorTaskBoardItem) => {
    void Haptics.selectionAsync();
    const nextStatus = item.status === "done" ? "for_review" : "done";
    if (item.persisted) {
      void setTaskStatus({
        environmentId: target.environmentId,
        input: {
          threadId: target.threadId,
          taskId: item.id,
          status: nextStatus,
        },
      });
      return;
    }
    void upsertTask({
      environmentId: target.environmentId,
      input: {
        threadId: target.threadId,
        title: item.title,
        status: nextStatus,
        subagentId: item.subagent?.id ?? null,
        childThreadId: item.childThreadId,
      },
    });
  };

  const groups: ReadonlyArray<{
    readonly status: OrchestrationV2OrchestratorTaskStatus;
    readonly items: ReadonlyArray<OrchestratorTaskBoardItem>;
  }> =
    board === null
      ? []
      : [
          { status: "needs_attention" as const, items: board.needsAttention },
          { status: "in_progress" as const, items: board.inProgress },
          { status: "for_review" as const, items: board.forReview },
          { status: "done" as const, items: board.done },
        ].filter((group) => group.items.length > 0);

  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      <SheetHeader title={gt("Tasks")} onClose={() => navigation.goBack()} />
      <ScreenContent>
        <ScrollView
          nestedScrollEnabled
          className="flex-1"
          contentInsetAdjustmentBehavior="automatic"
          contentContainerClassName="px-5 pb-6"
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) + 8 }}
        >
          {groups.length === 0 ? (
            <Text className="pt-6 text-center text-sm text-foreground-muted">
              <T>No delegated tasks yet. Ask the orchestrator to start a task.</T>
            </Text>
          ) : (
            groups.map((group) => (
              <View key={group.status} className="mt-4">
                <Text className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground-muted">
                  {groupHeading(gt, group.status)} ({group.items.length})
                </Text>
                {group.items.map((item) => (
                  <TaskRow
                    key={item.id}
                    item={item}
                    depth={0}
                    onOpenChild={openChildThread}
                    onToggleDone={handleToggleDone}
                  />
                ))}
              </View>
            ))
          )}
        </ScrollView>
      </ScreenContent>
    </View>
  );
}

function TaskRow(props: {
  readonly item: OrchestratorTaskBoardItem;
  readonly depth: number;
  readonly onOpenChild: (childThreadId: ThreadId) => void;
  readonly onToggleDone: (item: OrchestratorTaskBoardItem) => void;
}) {
  const { item, depth, onOpenChild, onToggleDone } = props;
  const gt = useGT();
  const canOpen = item.childThreadId !== null;
  const toggleLabel = item.status === "done" ? gt("Reopen") : gt("Done");

  const body = (
    <View className="min-w-0 flex-1">
      <View className="flex-row items-center gap-2">
        <Text className="font-mono text-xs text-foreground-muted">{item.key}</Text>
        <Text className="min-w-0 flex-1 text-sm text-foreground" numberOfLines={2}>
          {item.title}
        </Text>
      </View>
      {item.modelLabel || item.totalChildCount > 0 ? (
        <View className="mt-1 flex-row flex-wrap items-center gap-2">
          {item.modelLabel ? (
            <Text className="font-mono text-xs text-foreground-muted">{item.modelLabel}</Text>
          ) : null}
          {item.totalChildCount > 0 ? (
            <Text className="text-xs text-foreground-muted">
              {item.completedChildCount}/{item.totalChildCount}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );

  return (
    <View>
      <View
        className="flex-row items-center gap-2 border-b border-border py-3"
        style={depth > 0 ? { paddingLeft: depth * 16 } : undefined}
      >
        {canOpen ? (
          <Pressable
            accessibilityRole="link"
            onPress={() => onOpenChild(item.childThreadId!)}
            className="min-w-0 flex-1 active:opacity-70"
          >
            {body}
          </Pressable>
        ) : (
          body
        )}
        {item.status === "for_review" || item.status === "done" ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => onToggleDone(item)}
            className="rounded-md border border-border px-2.5 py-1 active:opacity-70"
          >
            <Text className="text-xs font-medium text-foreground">{toggleLabel}</Text>
          </Pressable>
        ) : null}
      </View>
      {item.children.map((child) => (
        <TaskRow
          key={child.id}
          item={child}
          depth={depth + 1}
          onOpenChild={onOpenChild}
          onToggleDone={onToggleDone}
        />
      ))}
    </View>
  );
}
