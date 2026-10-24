import { describe, expect, it } from "vitest";
import { reactive } from "vue";
import {
  flattenRSS,
  newRSSRule,
  normalizeRSSRule,
  serializeRSSRule,
  searchCategories,
  safeExternalURL,
  peerList,
} from "./native-tools";
import { demoToolsRequest } from "./demo-tools";

describe("native tools contracts", () => {
  it("retains nested RSS paths and does not turn articles into folders", () => {
    const result = flattenRSS({
      Linux: {
        Releases: {
          url: "https://example.org/rss",
          articles: [{ id: "a", title: "Debian" }],
        },
      },
      Empty: {},
    });
    expect(result.map((item) => [item.path, item.feed])).toEqual([
      ["Linux", false],
      ["Linux\\Releases", true],
      ["Empty", false],
    ]);
  });
  it("preserves native rule extensions and explicit false torrent options", () => {
    const original = {
      ...newRSSRule(),
      torrentParams: { category: "Linux", stopped: false, future: 7 },
      futureRule: true,
    };
    const edited = normalizeRSSRule(original);
    edited.savePath = "/downloads/linux";
    edited.affectedFeeds = ["https://a.test/rss", "https://a.test/rss", " "];
    const saved = JSON.parse(serializeRSSRule(edited));
    expect(saved.torrentParams).toMatchObject({
      category: "Linux",
      stopped: false,
      future: 7,
      save_path: "/downloads/linux",
    });
    expect(saved.futureRule).toBe(true);
    edited.torrentContentLayout = undefined;
    edited.torrentParams!.content_layout = "Subfolder";
    expect(
      JSON.parse(serializeRSSRule(edited)).torrentParams.content_layout,
    ).toBeNull();
    expect(saved.affectedFeeds).toEqual(["https://a.test/rss"]);
  });
  it("copies reactive API rules without sharing edits", () => {
    const source = reactive({
      ...newRSSRule(),
      mustContain: "Debian",
      affectedFeeds: ["https://a.test/rss"],
    });
    const copy = normalizeRSSRule(source);
    copy.affectedFeeds.push("https://b.test/rss");
    expect(source.affectedFeeds).toEqual(["https://a.test/rss"]);
  });
  it("preserves PCRE expressions and rejects negative RSS match delay", () => {
    expect(
      JSON.parse(
        serializeRSSRule({
          ...newRSSRule(),
          useRegex: true,
          mustContain: "(?i)debian",
        }),
      ).mustContain,
    ).toBe("(?i)debian");
    expect(() =>
      serializeRSSRule({ ...newRSSRule(), ignoreDays: -1 }),
    ).toThrow();
  });
  it("lists common search categories for the selected plugins", () => {
    const plugins = [
      {
        name: "a",
        enabled: true,
        supportedCategories: [
          { id: "all", name: "全部" },
          { id: "tv", name: "电视" },
        ],
      },
      {
        name: "b",
        enabled: true,
        supportedCategories: [{ id: "all", name: "All" }],
      },
    ];
    expect(searchCategories(plugins, "enabled").map((c) => c.id)).toEqual([
      "all",
    ]);
    expect(searchCategories(plugins, "a").map((c) => c.id)).toEqual([
      "all",
      "tv",
    ]);
  });
  it("allows only web links in external anchors and validates peer port ranges", () => {
    expect(safeExternalURL("javascript:alert(1)")).toBeUndefined();
    expect(safeExternalURL("https://example.org/a")).toBe(
      "https://example.org/a",
    );
    expect(peerList("127.0.0.1:6881\n[::1]:443")).toBe(
      "127.0.0.1:6881|[::1]:443",
    );
    expect(() => peerList("example.org:99999")).toThrow();
  });
});

describe("native tools demo lifecycle", () => {
  it("starts, stops, paginates and deletes an isolated search job", async () => {
    const started = await demoToolsRequest("/api/v2/search/start", {
      method: "POST",
      body: new URLSearchParams({
        pattern: "Debian",
        plugins: "enabled",
        category: "all",
      }),
    });
    const id = (started.value as { id: number }).id;
    const result = await demoToolsRequest(
      `/api/v2/search/results?id=${id}&limit=1&offset=0`,
      {},
    );
    expect((result.value as { results: unknown[] }).results).toHaveLength(1);
    await demoToolsRequest("/api/v2/search/stop", {
      method: "POST",
      body: new URLSearchParams({ id: String(id) }),
    });
    const status = await demoToolsRequest(`/api/v2/search/status?id=${id}`, {});
    expect((status.value as { status: string }[])[0]?.status).toBe("Stopped");
    await demoToolsRequest("/api/v2/search/delete", {
      method: "POST",
      body: new URLSearchParams({ id: String(id) }),
    });
    await expect(
      demoToolsRequest(`/api/v2/search/results?id=${id}`, {}),
    ).rejects.toThrow();
  });
  it("applies exclusion rules and keeps RSS folder moves and read markers", async () => {
    const post = (path: string, fields: Record<string, string>) =>
      demoToolsRequest(`/api/v2/rss/${path}`, {
        method: "POST",
        body: new URLSearchParams(fields),
      });
    await post("setRule", {
      ruleName: "Exclude",
      ruleDef: JSON.stringify({
        ...newRSSRule(),
        mustContain: "Debian",
        mustNotContain: "amd64",
        affectedFeeds: ["https://example.org/releases.rss"],
      }),
    });
    const matching = await demoToolsRequest(
      "/api/v2/rss/matchingArticles?ruleName=Exclude",
      {},
    );
    expect(
      Object.values(matching.value as Record<string, string[]>).flat(),
    ).toEqual([]);
    await post("addFolder", { path: "Moved" });
    await post("moveItem", {
      itemPath: "Linux\\Releases",
      destPath: "Moved\\Releases",
    });
    await post("markAsRead", {
      itemPath: "Moved\\Releases",
      articleId: "debian-13",
    });
    const tree = await demoToolsRequest("/api/v2/rss/items?withData=true", {});
    expect(
      flattenRSS(tree.value as Parameters<typeof flattenRSS>[0]).find(
        (item) => item.path === "Moved\\Releases",
      )?.data?.articles?.[0]?.isRead,
    ).toBe(true);
  });
  it("returns unhandled for unsupported endpoints", async () => {
    expect(await demoToolsRequest("/api/v2/search/notSupported", {})).toEqual({
      handled: false,
    });
  });
});
