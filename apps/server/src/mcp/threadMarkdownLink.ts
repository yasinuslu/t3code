import { formatThreadDeepLink, type ThreadLinkTarget } from "@t3tools/shared/threadLinks";

/** Environment-qualified thread link for MCP results, so peer and manager threads resolve too. */
export function formatThreadMarkdownLink(target: ThreadLinkTarget & { readonly title: string }) {
  const title = target.title.replace(/\s+/g, " ").trim() || "Thread";
  return `[${title.replace(/[\\[\]]/g, "\\$&")}](${formatThreadDeepLink(target)})`;
}
