import { formatThreadLink, type ThreadLinkTarget } from "@t3tools/shared/threadLinks";

/** Environment-qualified thread link for MCP results, so peer and manager threads resolve too. */
export function formatThreadMarkdownLink(target: ThreadLinkTarget & { readonly title: string }) {
  return formatThreadLink(target, target.title.trim() || "Thread");
}
