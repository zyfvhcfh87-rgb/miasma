import { useLocale, useMessages } from "gt-react-native";
import { useEffect, useEffectEvent } from "react";
import { republishAgentActivityWidget } from "./publishAgentActivityWidget";

export function AgentActivityWidgetCoordinator() {
  const resolve = useMessages();
  const locale = useLocale();
  const republishActivity = useEffectEvent(() => {
    republishAgentActivityWidget(resolve).catch((error: unknown) => {
      console.warn("Could not update agent activity widget", error);
    });
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- republishes the agent activity widget's copy in the new UI language
  useEffect(
    () => republishActivity(),
    [
      // oxlint-disable-next-line react/exhaustive-effect-dependencies -- the widget's copy follows the UI language.
      locale,
    ],
  );
  return null;
}
