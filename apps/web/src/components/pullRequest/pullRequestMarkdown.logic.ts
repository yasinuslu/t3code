import {
  changeRequestLinkResolver,
  changeRequestReferenceAutolinker,
} from "@t3tools/client-runtime/pull-request-markdown";
import {
  sourceControlClients,
  type ReferenceAutolink,
} from "@t3tools/client-runtime/source-control-clients";
import type { PluggableList } from "unified";

export {
  splitPullRequestBody,
  type PullRequestBodySegment,
} from "@t3tools/client-runtime/pull-request-markdown";

type MarkdownNode = {
  type: string;
  value?: string;
  children?: MarkdownNode[];
  url?: string;
  data?: unknown;
};

const AUTOLINK_IGNORED_TYPES = new Set(["link", "linkReference"]);

export function remarkPullRequestAutolinks(options: {
  readonly autolinks: (text: string) => ReadonlyArray<ReferenceAutolink>;
}) {
  const visit = (node: MarkdownNode): void => {
    const children = node.children;
    if (children === undefined) return;
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index]!;
      if (AUTOLINK_IGNORED_TYPES.has(child.type)) continue;
      if (child.type !== "text" || child.value === undefined) {
        visit(child);
        continue;
      }
      const value = child.value;
      const links = options.autolinks(value);
      if (links.length === 0) continue;
      const replacements: MarkdownNode[] = [];
      let start = 0;
      for (const link of links) {
        if (start < link.index) {
          replacements.push({ type: "text", value: value.slice(start, link.index) });
        }
        replacements.push({
          type: "link",
          url: link.url,
          data: { hProperties: { dataPullRequestAutolink: link.kind } },
          children: [{ type: "text", value: link.label }],
        });
        start = link.index + link.text.length;
      }
      if (start < value.length) replacements.push({ type: "text", value: value.slice(start) });
      children.splice(index, 1, ...replacements);
      index += replacements.length - 1;
    }
  };
  return (tree: MarkdownNode) => visit(tree);
}

const LINKED_TYPES = new Set(["image", "link", "definition"]);
const HTML_SOURCE = /(<[a-z][^<>]*?\bsrc\s*=\s*["'])([^"'<>]*)/giu;

/**
 * Resolves the link destinations the host writes relative to its server. It runs on the parsed
 * tree because code is never a link, so a destination written inside code keeps its text.
 */
export function remarkPullRequestRelativeUrls(options: {
  readonly resolveUrl: (url: string) => string;
}) {
  const visit = (node: MarkdownNode): void => {
    if (LINKED_TYPES.has(node.type) && node.url !== undefined) {
      node.url = options.resolveUrl(node.url);
    } else if (node.type === "html" && node.value !== undefined) {
      node.value = node.value.replace(
        HTML_SOURCE,
        (_tag, prefix: string, url: string) => `${prefix}${options.resolveUrl(url)}`,
      );
    }
    node.children?.forEach(visit);
  };
  return (tree: MarkdownNode) => visit(tree);
}

const NO_AUTOLINK_PLUGINS: PluggableList = [];
const autolinkPlugins = new Map<string, PluggableList>();

/**
 * One plugin list per repository, so every comment of a pull request shares one markdown
 * renderer and its parse cache instead of parsing again on each render.
 */
export function pullRequestAutolinkPlugins(
  changeRequest: { readonly provider: string; readonly url: string } | null,
): PluggableList {
  if (changeRequest === null) return NO_AUTOLINK_PLUGINS;
  const repositoryUrl = sourceControlClients.parseChangeRequestUrl(changeRequest.url)?.link
    .repositoryUrl;
  if (repositoryUrl === undefined) return NO_AUTOLINK_PLUGINS;
  const key = `${changeRequest.provider}\u0000${repositoryUrl}`;
  let plugins = autolinkPlugins.get(key);
  if (plugins === undefined) {
    const autolinks = changeRequestReferenceAutolinker(changeRequest);
    const resolveUrl = changeRequestLinkResolver(changeRequest);
    const list: PluggableList = [];
    if (autolinks) list.push([remarkPullRequestAutolinks, { autolinks }]);
    if (resolveUrl) list.push([remarkPullRequestRelativeUrls, { resolveUrl }]);
    plugins = list.length > 0 ? list : NO_AUTOLINK_PLUGINS;
    autolinkPlugins.set(key, plugins);
  }
  return plugins;
}
