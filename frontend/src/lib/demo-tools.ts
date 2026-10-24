import {
  flattenRSS,
  newRSSRule,
  type RSSRule,
  type RSSTree,
  type SearchJob,
  type SearchPlugin,
  type SearchResult,
} from "./native-tools";
interface DemoState {
  tree: RSSTree;
  rules: Record<string, RSSRule>;
  plugins: SearchPlugin[];
  jobs: (SearchJob & { results: SearchResult[] })[];
  nextID: number;
  categories: Record<string, { name: string; savePath: string }>;
  tags: string[];
  banned: string[];
}
const storageKey = "orbitdown-demo-native-tools-v1";
function initialState(): DemoState {
  return {
    tree: {
      Linux: {
        Releases: {
          url: "https://example.org/releases.rss",
          title: "Linux 发行版",
          articles: [
            {
              id: "debian-13",
              title: "Debian 13 amd64",
              date: new Date().toISOString(),
              torrentURL: "https://example.org/debian.torrent",
              link: "https://www.debian.org/",
              description: "Debian 安装镜像",
              isRead: false,
            },
          ],
        },
      },
    },
    rules: {
      "Linux 发行版": {
        ...newRSSRule(),
        mustContain: "Debian",
        affectedFeeds: ["https://example.org/releases.rss"],
        assignedCategory: "软件",
      },
    },
    plugins: [
      {
        name: "linux",
        fullName: "Linux 发行版",
        enabled: true,
        version: "1.0",
        url: "https://example.org/",
        supportedCategories: [
          { id: "all", name: "全部" },
          { id: "software", name: "软件" },
        ],
      },
    ],
    jobs: [],
    nextID: 1,
    categories: {
      软件: { name: "软件", savePath: "/downloads/软件" },
      影视: { name: "影视", savePath: "/downloads/影视" },
      资料: { name: "资料", savePath: "/downloads/资料" },
      音乐: { name: "音乐", savePath: "/downloads/音乐" },
    },
    tags: ["Linux", "开源", "收藏", "无损"],
    banned: [],
  };
}
function restore(): DemoState {
  try {
    const saved = (
      typeof window === "undefined" ? undefined : window.localStorage
    )?.getItem(storageKey);
    if (saved) return JSON.parse(saved);
  } catch {}
  return initialState();
}
let state = restore();
function persist() {
  try {
    (typeof window === "undefined" ? undefined : window.localStorage)?.setItem(
      storageKey,
      JSON.stringify(state, (key, value) =>
        key === "ssl_private_key" ? undefined : value,
      ),
    );
  } catch {}
}
function parent(path: string) {
  const parts = path.split("\\").filter(Boolean),
    name = parts.pop() || "";
  let node = state.tree;
  for (const part of parts) {
    const next = node[part];
    if (!next || typeof next.url === "string") throw new Error("文件夹不存在");
    node = next as RSSTree;
  }
  return { node, name };
}
function item(path: string) {
  const { node, name } = parent(path);
  return name ? node[name] : state.tree;
}
function matchesDemoRule(
  title: string,
  articleDate: string | undefined,
  rule: RSSRule,
): boolean {
  const expression = (value: string) => {
    if (rule.useRegex) {
      let pattern = value,
        flags = "i";
      if (pattern.startsWith("(?i)")) pattern = pattern.slice(4);
      try {
        return new RegExp(pattern, flags).test(title);
      } catch {
        throw new Error(
          "演示模式无法解析此 PCRE2 表达式，请连接 qBittorrent 验证",
        );
      }
    }
    return value.split("|").some((group) =>
      group
        .split(/\s+/)
        .filter(Boolean)
        .every((token) =>
          new RegExp(
            token
              .split("*")
              .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
              .join(".*"),
            "i",
          ).test(title),
        ),
    );
  };
  if (rule.mustContain && !expression(rule.mustContain)) return false;
  if (rule.mustNotContain && expression(rule.mustNotContain)) return false;
  if (
    rule.ignoreDays > 0 &&
    rule.lastMatch &&
    articleDate &&
    Date.parse(articleDate) <
      Date.parse(rule.lastMatch) + rule.ignoreDays * 86400000
  )
    return false;
  const episode = title.match(/\b(?:s(\d+)[ ._-]?e(\d+)|(\d+)x(\d+))\b/i);
  if (rule.episodeFilter) {
    const filter = rule.episodeFilter.match(/^(\d+)x(.+);$/);
    if (!filter || !episode) return false;
    const season = Number(episode[1] || episode[3]),
      number = Number(episode[2] || episode[4]);
    if (
      !filter[2]!
        .split(";")
        .filter(Boolean)
        .some((range) => {
          const [start, end] = range.split("-");
          return range.includes("-")
            ? (season === Number(filter[1]) &&
                number >= Number(start) &&
                (!end || number <= Number(end))) ||
                (!end && season > Number(filter[1]))
            : season === Number(filter[1]) && number === Number(start);
        })
    )
      return false;
  }
  if (rule.smartFilter) {
    const date = title.match(/\b(\d{4})[ ._-](\d{2})[ ._-](\d{2})\b/);
    const episodeID = episode
      ? `${Number(episode[1] || episode[3])}x${Number(episode[2] || episode[4])}`
      : date
        ? `${Number(date[1])}x${Number(date[2])}x${Number(date[3])}`
        : "";
    if (episodeID && rule.previouslyMatchedEpisodes.includes(episodeID))
      return false;
  }
  return true;
}
export async function demoToolsRequest(
  path: string,
  init: RequestInit,
): Promise<{ handled: boolean; value?: unknown }> {
  const url = new URL(path, "https://demo.invalid"),
    endpoint = url.pathname;
  const body =
    init.body instanceof URLSearchParams
      ? init.body
      : new URLSearchParams(typeof init.body === "string" ? init.body : "");
  const get = (name: string) =>
    body.get(name) ?? url.searchParams.get(name) ?? "";
  const value = (data: unknown = "") => {
    persist();
    return { handled: true, value: structuredClone(data) };
  };
  const job = () => {
    const found = state.jobs.find(
      (candidate) => candidate.id === Number(get("id")),
    );
    if (!found) throw new Error("搜索任务不存在");
    return found;
  };
  switch (endpoint) {
    case "/api/v2/rss/items":
      return value(state.tree);
    case "/api/v2/rss/rules":
      return value(state.rules);
    case "/api/v2/rss/addFolder": {
      const { node, name } = parent(get("path"));
      if (!name || node[name]) throw new Error("文件夹已存在或名称为空");
      node[name] = {};
      return value();
    }
    case "/api/v2/rss/addFeed": {
      const feedURL = get("url");
      const path = get("path") || new URL(feedURL).hostname;
      const { node, name } = parent(path);
      if (node[name]) throw new Error("订阅已存在");
      node[name] = { url: feedURL, title: name, articles: [] };
      return value();
    }
    case "/api/v2/rss/removeItem": {
      const { node, name } = parent(get("path"));
      delete node[name];
      return value();
    }
    case "/api/v2/rss/moveItem": {
      const source = parent(get("itemPath")),
        target = parent(get("destPath"));
      if (!source.node[source.name] || target.node[target.name])
        throw new Error("路径不存在或目标已存在");
      target.node[target.name] = source.node[source.name]!;
      delete source.node[source.name];
      return value();
    }
    case "/api/v2/rss/markAsRead": {
      const root = item(get("itemPath"));
      const feeds =
        root && typeof root.url === "string"
          ? [root]
          : flattenRSS((root || {}) as RSSTree)
              .filter((i) => i.feed)
              .map((i) => i.data!);
      for (const feed of feeds) {
        const articles = feed.articles as
          { id: string; isRead?: boolean }[] | undefined;
        for (const article of articles || [])
          if (!get("articleId") || article.id === get("articleId"))
            article.isRead = true;
      }
      return value();
    }
    case "/api/v2/rss/refreshItem": {
      const selected = item(get("itemPath"));
      if (!selected) throw new Error("订阅或文件夹不存在");
      if (typeof selected.url === "string")
        selected.lastBuildDate = new Date().toISOString();
      return value();
    }
    case "/api/v2/rss/setRule":
      state.rules[get("ruleName")] = JSON.parse(get("ruleDef"));
      return value();
    case "/api/v2/rss/removeRule":
      delete state.rules[get("ruleName")];
      return value();
    case "/api/v2/rss/renameRule": {
      const rule = state.rules[get("ruleName")];
      if (!rule) throw new Error("规则不存在");
      state.rules[get("newRuleName")] = rule;
      delete state.rules[get("ruleName")];
      return value();
    }
    case "/api/v2/rss/matchingArticles": {
      const rule = state.rules[get("ruleName")];
      if (!rule) throw new Error("规则不存在");
      const matches: Record<string, string[]> = {};
      for (const feed of flattenRSS(state.tree).filter((i) => i.feed)) {
        if (!rule.affectedFeeds.includes(feed.data!.url)) continue;
        matches[feed.name] = (feed.data!.articles || [])
          .filter((article) =>
            matchesDemoRule(article.title, article.date, rule),
          )
          .map((article) => article.title);
      }
      return value(matches);
    }
    case "/api/v2/search/plugins":
      return value(state.plugins);
    case "/api/v2/search/start": {
      const id = state.nextID++;
      const results = ["amd64", "arm64"].map((arch, index) => ({
        fileName: `${get("pattern")} ${arch}`,
        fileSize: 3.7 * 1024 ** 3,
        fileUrl: `https://example.org/${encodeURIComponent(get("pattern"))}-${arch}.torrent`,
        descrLink: "https://example.org/",
        nbSeeders: 120 - index * 15,
        nbLeechers: 8,
        siteUrl: "https://example.org/",
      }));
      state.jobs.push({
        id,
        status: "Running",
        total: results.length,
        results,
      });
      return value({ id });
    }
    case "/api/v2/search/status":
      return value(
        state.jobs
          .filter((j) => !get("id") || j.id === Number(get("id")))
          .map(({ id, total, status }) => ({ id, total, status })),
      );
    case "/api/v2/search/results": {
      const current = job(),
        offset = Math.max(0, Number(get("offset")) || 0),
        limit = Number(get("limit"));
      current.status = "Stopped";
      return value({
        results: current.results.slice(
          offset,
          limit > 0 ? offset + limit : undefined,
        ),
        total: current.total,
        status: current.status,
      });
    }
    case "/api/v2/search/stop":
      job().status = "Stopped";
      return value();
    case "/api/v2/search/delete": {
      const current = job();
      state.jobs = state.jobs.filter((j) => j !== current);
      return value();
    }
    case "/api/v2/search/enablePlugin":
      for (const plugin of state.plugins)
        if (get("names").split("|").includes(plugin.name))
          plugin.enabled = get("enable") === "true";
      return value();
    case "/api/v2/search/uninstallPlugin":
      state.plugins = state.plugins.filter(
        (plugin) => !get("names").split("|").includes(plugin.name),
      );
      return value();
    case "/api/v2/search/installPlugin":
      for (const source of get("sources").split("|")) {
        const name = source.split("/").pop()?.replace(/\.py$/, "") || "plugin";
        if (!state.plugins.some((p) => p.name === name))
          state.plugins.push({
            name,
            fullName: name,
            enabled: true,
            version: "1.0",
            supportedCategories: [{ id: "all", name: "全部" }],
          });
      }
      return value();
    case "/api/v2/search/updatePlugins":
      return value();
    case "/api/v2/torrents/categories":
      return value(state.categories);
    case "/api/v2/torrents/createCategory":
    case "/api/v2/torrents/editCategory":
      state.categories[get("category")] = {
        name: get("category"),
        savePath: get("savePath"),
      };
      return value();
    case "/api/v2/torrents/removeCategories":
      for (const name of get("categories").split("\n"))
        delete state.categories[name];
      return value();
    case "/api/v2/torrents/tags":
      return value(state.tags);
    case "/api/v2/torrents/createTags":
      state.tags = [
        ...new Set([
          ...state.tags,
          ...get("tags")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        ]),
      ];
      return value();
    case "/api/v2/torrents/deleteTags":
      state.tags = state.tags.filter(
        (tag) =>
          !get("tags")
            .split(",")
            .map((s) => s.trim())
            .includes(tag),
      );
      return value();
    case "/api/v2/log/main":
      return value(
        [
          {
            id: 0,
            message: "qBittorrent 演示实例已启动",
            timestamp: Math.floor(Date.now() / 1000),
            type: 1,
          },
          {
            id: 1,
            message: "外部连接不可用（演示）",
            timestamp: Math.floor(Date.now() / 1000),
            type: 4,
          },
        ].filter(
          (entry) =>
            get(
              (
                {
                  1: "normal",
                  2: "info",
                  4: "warning",
                  8: "critical",
                } as Record<number, string>
              )[entry.type]!,
            ) !== "false",
        ),
      );
    case "/api/v2/log/peers":
      return value(
        state.banned.map((ip, id) => ({
          id,
          ip,
          blocked: true,
          reason: "手动封禁",
          timestamp: Math.floor(Date.now() / 1000),
        })),
      );
    case "/api/v2/transfer/banPeers":
      state.banned.push(...get("peers").split("|"));
      return value();
    case "/api/v2/app/version":
      return value("v5.0.0-demo");
    case "/api/v2/app/webapiVersion":
      return value("2.11.0");
    case "/api/v2/app/buildInfo":
      return value({
        qt: "6.7.2",
        libtorrent: "2.0.10",
        boost: "1.85",
        openssl: "3.3",
        bitness: 64,
      });
    case "/api/v2/app/shutdown":
      throw new Error("演示模式不能关闭服务");
    default:
      return { handled: false };
  }
}
