import { describe, expect, it } from "vitest";
import {
  rateLimit,
  shareLimits,
  renamePath,
  mergePeers,
  peerAddress,
  pieceSummary,
} from "./torrent-operations";
import { demoTorrentOperation } from "./demo-torrent-operations";
import type { NativeTorrent } from "./torrent-operations";

describe("native torrent limits", () => {
  it("converts KiB/s to bytes and rejects negative or nonfinite values", () => {
    expect(rateLimit("1.5")).toBe("1536");
    expect(rateLimit("0")).toBe("0");
    for (const value of ["", "-1", "Infinity", "NaN"])
      expect(() => rateLimit(value)).toThrow();
  });
  it("preserves native share-limit sentinels but rejects fractional minutes", () => {
    expect(shareLimits("-2", "-1", "30")).toEqual({
      ratioLimit: "-2",
      seedingTimeLimit: "-1",
      inactiveSeedingTimeLimit: "30",
    });
    expect(shareLimits("1.25", "0", "-2").ratioLimit).toBe("1.25");
    expect(() => shareLimits("-1.5", "0", "0")).toThrow();
    expect(() => shareLimits("1", "1.5", "0")).toThrow();
  });
});
describe("relative torrent paths", () => {
  it("replaces a basename without encoding or losing the parent directory", () => {
    expect(renamePath("电影/第一集 100%.mkv", "第二集 & 花絮.mkv")).toBe(
      "电影/第二集 & 花絮.mkv",
    );
    expect(renamePath("root", "new root")).toBe("new root");
  });
  it("rejects traversal and separators in the new basename", () => {
    for (const name of ["..", ".", "/tmp/x", "a/b", "a\\b", "", "a\0b"])
      expect(() => renamePath("a/file", name)).toThrow();
    for (const old of ["../file", "/file", "a//file"])
      expect(() => renamePath(old, "new")).toThrow();
  });
});
describe("peer incremental responses", () => {
  it("merges partial fields, removes peers, and resets on full update without mutating cache", () => {
    const initial = {
      a: { ip: "192.0.2.1", port: 1, client: "test", dl_speed: 1 },
      b: { ip: "192.0.2.2" },
    };
    const next = mergePeers(initial, {
      rid: 2,
      peers: { a: { dl_speed: 5 } },
      peers_removed: ["b"],
    });
    expect(next.a).toEqual({ ...initial.a, dl_speed: 5 });
    expect(next.b).toBeUndefined();
    expect(initial.a.dl_speed).toBe(1);
    expect(mergePeers(next, { rid: 3, full_update: true })).toEqual({});
  });
  it("uses a null prototype for untrusted peer keys and brackets IPv6 endpoints", () => {
    const result = mergePeers(
      {},
      { rid: 1, peers: JSON.parse('{"__proto__":{"ip":"x"}}') },
    );
    expect(Object.getPrototypeOf(result)).toBe(null);
    expect(peerAddress({ ip: "2001:db8::1", port: 6881 })).toBe(
      "[2001:db8::1]:6881",
    );
    expect(peerAddress({ ip: "192.0.2.1", port: 6881 })).toBe("192.0.2.1:6881");
    expect(peerAddress({ ip: "192.0.2.1" })).toBe("");
  });
});
describe("piece states", () => {
  it("counts native states including unknown values without treating them as downloaded", () => {
    expect(pieceSummary([0, 1, 2, 2, 9])).toEqual({
      missing: 1,
      downloading: 1,
      complete: 2,
      unknown: 1,
    });
  });
});

describe("native torrent demo adapter", () => {
  const task = (hash: string): NativeTorrent => ({
    hash,
    name: "folder/file.mkv",
    state: "downloading",
    progress: 0.5,
    size: 1024,
    total_size: 1024,
    dlspeed: 2,
    upspeed: 1,
    downloaded: 512,
    uploaded: 20,
    ratio: 0.1,
    eta: 10,
    category: "视频",
    tags: "收藏",
    num_seeds: 2,
    num_leechs: 1,
    save_path: "/downloads",
    added_on: 0,
    completion_on: 0,
  });
  const post = (
    route: string,
    data: Record<string, string>,
    tasks: Record<string, NativeTorrent>,
  ) =>
    demoTorrentOperation(
      "/api/v2/" + route,
      { method: "POST", body: new URLSearchParams(data) },
      tasks,
    );
  it("changes only selected tasks and uses native explicit flags and limit units", async () => {
    const tasks = { a: task("a"), b: task("b") };
    await post(
      "torrents/setDownloadLimit",
      { hashes: "a", limit: "1536" },
      tasks,
    );
    await post("torrents/setForceStart", { hashes: "a", value: "true" }, tasks);
    expect(tasks.a.dl_limit).toBe(1536);
    expect(tasks.b.dl_limit).toBeUndefined();
    expect(tasks.a.force_start).toBe(true);
    expect(tasks.a.state).toBe("forcedDL");
    await post("torrents/removeTags", { hashes: "a", tags: "" }, tasks);
    expect(tasks.a.tags).toBe("");
    expect(tasks.b.tags).toBe("收藏");
  });
  it("persists tracker edits and removal including encoded percent characters", async () => {
    const tasks = { a: task("a") },
      url = "https://tracker.example/100%25?a=1&b=2";
    await post("torrents/addTrackers", { hash: "a", urls: url }, tasks);
    await post(
      "torrents/editTracker",
      { hash: "a", origUrl: url, newUrl: url + "x" },
      tasks,
    );
    await post(
      "torrents/removeTrackers",
      { hash: "a", urls: encodeURIComponent(url + "x") },
      tasks,
    );
    const result = await demoTorrentOperation(
      "/api/v2/torrents/trackers?hash=a",
      {},
      tasks,
    );
    expect(JSON.stringify(result.value)).not.toContain("100%");
  });
  it("renames nested folders and files while preserving separators", async () => {
    const tasks = { a: task("a") };
    await post(
      "torrents/renameFolder",
      { hash: "a", oldPath: "folder", newPath: "资料 & 视频" },
      tasks,
    );
    await post(
      "torrents/renameFile",
      {
        hash: "a",
        oldPath: "资料 & 视频/file.mkv",
        newPath: "资料 & 视频/100%.mkv",
      },
      tasks,
    );
    const result = await demoTorrentOperation(
      "/api/v2/torrents/files?hash=a",
      {},
      tasks,
    );
    expect(result.value).toMatchObject([{ name: "资料 & 视频/100%.mkv" }]);
  });
  it("persists peer addition/ban and isolates separate demo instances", async () => {
    const first = { a: task("a") },
      second = { a: task("a") };
    await post(
      "torrents/addPeers",
      { hashes: "a", peers: "[2001:db8::1]:6881" },
      first,
    );
    const added = await demoTorrentOperation(
      "/api/v2/sync/torrentPeers?hash=a&rid=0",
      {},
      first,
    );
    expect(JSON.stringify(added.value)).toContain("2001:db8::1");
    await post("transfer/banPeers", { peers: "[2001:db8::1]:6881" }, first);
    expect(
      JSON.stringify(
        (
          await demoTorrentOperation(
            "/api/v2/sync/torrentPeers?hash=a",
            {},
            first,
          )
        ).value,
      ),
    ).not.toContain("2001:db8::1");
    expect(
      JSON.stringify(
        (
          await demoTorrentOperation(
            "/api/v2/sync/torrentPeers?hash=a",
            {},
            second,
          )
        ).value,
      ),
    ).not.toContain("2001:db8::1");
    expect(await demoTorrentOperation("/api/v2/unrelated", {}, first)).toEqual({
      handled: false,
    });
  });
  it("keeps banned IPs out of later task peer snapshots", async () => {
    const tasks = { a: task("a"), b: task("b") };
    await demoTorrentOperation("/api/v2/sync/torrentPeers?hash=a", {}, tasks);
    await post("transfer/banPeers", { peers: "192.0.2.20:6881" }, tasks);
    const later = await demoTorrentOperation(
      "/api/v2/sync/torrentPeers?hash=b",
      {},
      tasks,
    );
    expect(JSON.stringify(later.value)).not.toContain("192.0.2.20");
  });
});

it("accepts numeric values produced by Vue number inputs", () => {
  expect(rateLimit(256)).toBe("262144");
  expect(shareLimits(2, -1, -2)).toEqual({
    ratioLimit: "2",
    seedingTimeLimit: "-1",
    inactiveSeedingTimeLimit: "-2",
  });
});
