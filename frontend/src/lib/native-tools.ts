export interface RSSArticle {
  id: string;
  title: string;
  date?: string;
  author?: string;
  description?: string;
  link?: string;
  torrentURL?: string;
  isRead?: boolean;
}
export interface RSSFeed {
  url: string;
  title?: string;
  articles?: RSSArticle[];
  isLoading?: boolean;
  hasError?: boolean;
  lastBuildDate?: string;
}
export type RSSTree = { [name: string]: RSSFeed | RSSTree };
export interface RSSItem {
  name: string;
  path: string;
  depth: number;
  feed: boolean;
  data?: RSSFeed;
}
export function flattenRSS(tree: RSSTree, parent = "", depth = 0): RSSItem[] {
  return Object.entries(tree).flatMap(([name, node]) => {
    const path = parent ? `${parent}\\${name}` : name;
    const feed = typeof node.url === "string";
    return [
      { name, path, depth, feed, data: feed ? (node as RSSFeed) : undefined },
      ...(feed ? [] : flattenRSS(node as RSSTree, path, depth + 1)),
    ];
  });
}
export interface RSSRule {
  enabled: boolean;
  priority: number;
  mustContain: string;
  mustNotContain: string;
  useRegex: boolean;
  episodeFilter: string;
  smartFilter: boolean;
  previouslyMatchedEpisodes: string[];
  affectedFeeds: string[];
  ignoreDays: number;
  lastMatch: string;
  addPaused: boolean | null;
  assignedCategory: string;
  savePath: string;
  torrentContentLayout?: string | null;
  torrentParams?: Record<string, unknown>;
  [key: string]: unknown;
}
export function newRSSRule(): RSSRule {
  return {
    enabled: true,
    priority: 0,
    mustContain: "",
    mustNotContain: "",
    useRegex: false,
    episodeFilter: "",
    smartFilter: false,
    previouslyMatchedEpisodes: [],
    affectedFeeds: [],
    ignoreDays: 0,
    lastMatch: "",
    addPaused: null,
    assignedCategory: "",
    savePath: "",
  };
}
export function normalizeRSSRule(rule: Partial<RSSRule>): RSSRule {
  const result = { ...newRSSRule(), ...JSON.parse(JSON.stringify(rule)) };
  const params = result.torrentParams;
  if (params) {
    result.savePath = String(params.save_path ?? result.savePath);
    result.assignedCategory = String(
      params.category ?? result.assignedCategory,
    );
    if (typeof params.stopped === "boolean") result.addPaused = params.stopped;
    if (typeof params.content_layout === "string")
      result.torrentContentLayout = params.content_layout;
  }
  return result;
}
export function serializeRSSRule(rule: RSSRule): string {
  if (!Number.isInteger(rule.ignoreDays) || rule.ignoreDays < 0)
    throw new Error("忽略天数必须是非负整数");
  const result = {
    ...rule,
    affectedFeeds: [
      ...new Set(rule.affectedFeeds.map((url) => url.trim()).filter(Boolean)),
    ],
  };
  if (rule.torrentParams)
    result.torrentParams = {
      ...rule.torrentParams,
      save_path: rule.savePath,
      category: rule.assignedCategory,
      stopped: rule.addPaused,
      content_layout: rule.torrentContentLayout ?? null,
    };
  return JSON.stringify(result);
}
export interface SearchCategory {
  id: string;
  name: string;
}
export interface SearchPlugin {
  name: string;
  enabled: boolean;
  fullName?: string;
  version?: string;
  url?: string;
  supportedCategories: SearchCategory[];
}
export interface SearchJob {
  id: number;
  status: string;
  total: number;
}
export interface SearchResult {
  descrLink: string;
  fileName: string;
  fileSize: number;
  fileUrl: string;
  nbLeechers: number;
  nbSeeders: number;
  siteUrl: string;
}
export interface SearchResults {
  results: SearchResult[];
  status: string;
  total: number;
}
export function searchCategories(
  plugins: Pick<SearchPlugin, "name" | "enabled" | "supportedCategories">[],
  selection: string,
): SearchCategory[] {
  const chosen = plugins.filter(
    (plugin) =>
      selection === "all" ||
      (selection === "enabled"
        ? plugin.enabled
        : selection.split("|").includes(plugin.name)),
  );
  const categories =
    chosen[0]?.supportedCategories.filter((category) =>
      chosen.every((plugin) =>
        plugin.supportedCategories.some(
          (candidate) => candidate.id === category.id,
        ),
      ),
    ) || [];
  return [
    { id: "all", name: "全部分类" },
    ...categories.filter((category) => category.id !== "all"),
  ];
}
export function safeExternalURL(value: string | undefined): string | undefined {
  try {
    const url = new URL(value || "");
    return ["https:", "http:"].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}
export function peerList(value: string): string {
  const peers = [...new Set(value.split(/[\s|,]+/).filter(Boolean))];
  if (!peers.length) throw new Error("请输入连接地址");
  for (const peer of peers) {
    const match = peer.match(/^(?:\[[\da-fA-F:.]+\]|[a-zA-Z0-9.-]+):(\d+)$/);
    if (!match || Number(match[1]) < 1 || Number(match[1]) > 65535)
      throw new Error("地址格式为 IP:端口，IPv6 使用 [地址]:端口");
  }
  return peers.join("|");
}
export interface MainLog {
  id: number;
  message: string;
  timestamp: number;
  type: number;
}
export interface PeerLog {
  id: number;
  ip: string;
  timestamp: number;
  blocked: boolean;
  reason: string;
}
