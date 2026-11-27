import { useAtomValue } from "@effect/atom-react";
import { isProviderAvailable, type EnvironmentId } from "@t3tools/contracts";
import { CHATGPT_USAGE_URL, usesChatGptSharing } from "@t3tools/shared/chatGptSharing";
import { msg, T, useMessages, Var } from "gt-react-native";
import { Pressable, View } from "react-native";
import { tryOpenExternalUrl } from "../../lib/openExternalUrl";
import { AppText as Text } from "../../components/ui/AppText";
import { ProviderIcon } from "../../components/ProviderIcon";
import { environmentPresentations } from "../../state/presentation";

export function ChatGptUsageSummary({
  selectedEnvironmentIds,
}: {
  selectedEnvironmentIds: ReadonlySet<EnvironmentId> | null;
}) {
  const presentations = useAtomValue(environmentPresentations.presentationsWithProvidersAtom);
  const resolve = useMessages();
  const accountLabels = new Set<string>();
  for (const [environmentId, presentation] of presentations) {
    if (selectedEnvironmentIds !== null && !selectedEnvironmentIds.has(environmentId)) continue;
    for (const provider of presentation.serverConfig?.providers ?? []) {
      if (
        !provider.enabled ||
        !provider.installed ||
        !isProviderAvailable(provider) ||
        !usesChatGptSharing(provider)
      ) {
        continue;
      }
      accountLabels.add(
        resolve(
          msg("{provider} on {environment}", {
            provider: provider.displayName ?? provider.instanceId,
            environment: presentation.entry.target.label,
          }),
        ),
      );
    }
  }
  const accounts = [...accountLabels];
  if (accounts.length === 0) return null;
  return (
    <View className="gap-1">
      <View className="flex-row items-center justify-between gap-3">
        <View className="flex-row items-center gap-2">
          <ProviderIcon provider="codex" size={16} />
          <Text className="text-sm text-foreground">
            <T>ChatGPT shared usage</T>
          </Text>
        </View>
        <Pressable
          accessibilityRole="link"
          className="min-h-11 justify-center"
          onPress={() => void tryOpenExternalUrl(CHATGPT_USAGE_URL)}
        >
          <Text className="text-sm font-t3-medium text-primary">
            <T>Manage usage</T>
          </Text>
        </Pressable>
      </View>
      <Text className="text-xs text-foreground-muted">
        <T>
          <Var>{accounts.join(", ")}</Var>. Open ChatGPT with the account you connected.
        </T>
      </Text>
    </View>
  );
}
