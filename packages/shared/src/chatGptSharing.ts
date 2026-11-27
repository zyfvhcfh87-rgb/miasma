import type { ServerProvider } from "@t3tools/contracts";

export const CHATGPT_USAGE_URL = "https://chatgpt.com/#settings/Usage";
export const CHATGPT_USAGE_LIMIT_CODE = "subscription_sharing_usage_limit_exceeded";
/** A ChatGPT Business admin caps plan use in other apps; only the admin can raise it. */
export const CHATGPT_WORKSPACE_USAGE_LIMIT_CODE =
  "subscription_sharing_workplace_individual_usage_limit_exceeded";
/** OpenAI's partner guidelines fix this wording; the user sends it to their admin themselves. */
export const CHATGPT_WORKSPACE_ADMIN_REQUEST =
  "I've reached the limit for using my ChatGPT plan in Miasma. Could you increase our workspace's usage limits so I can continue?\n\nGo to admin.openai.com → Workspace → Usage limits. Thank you!";

export function usesChatGptSharing(provider: ServerProvider | null | undefined): boolean {
  return provider?.auth.status === "authenticated" && provider.auth.subscriptionSharing === true;
}
