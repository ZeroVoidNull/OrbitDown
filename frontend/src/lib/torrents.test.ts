import { describe, it, expect } from "vitest";
import { mergeMainData, filterTorrents, statusOf } from "./torrents";
import { bytes, duration, percent } from "./format";
import type { Torrent } from "./types";

const torrent = (hash: string, values: Partial<Torrent> = {}): Torrent => ({
  hash,
  name: "Ubuntu 24.04 LTS",
  state: "downloading",
  progress: 0.5,
  size: 1024,
  total_size: 1024,
  dlspeed: 100,
  upspeed: 0,
  downloaded: 512,
  uploaded: 0,
  ratio: 0,
  eta: 100,
  category: "软件",
  tags: "Linux",
  num_seeds: 5,
  num_leechs: 3,
  save_path: "/downloads",
  added_on: 100,
  completion_on: -1,
  ...values,
});

describe("incremental torrent synchronization", () => {
  it("retains unchanged fields when patches contain only a speed", () => {
    const data = mergeMainData(
      { a: torrent("a") },
      { rid: 2, torrents: { a: { dlspeed: 900 } } },
    );
    expect(data.a.name).toBe("Ubuntu 24.04 LTS");
    expect(data.a.dlspeed).toBe(900);
  });
  it("removes deleted tasks and replaces the entire cache on full updates", () => {
    const initial = { a: torrent("a"), b: torrent("b") };
    expect(
      Object.keys(mergeMainData(initial, { rid: 3, torrents_removed: ["a"] })),
    ).toEqual(["b"]);
    expect(
      Object.keys(
        mergeMainData(initial, {
          rid: 0,
          full_update: true,
          torrents: { c: torrent("c") },
        }),
      ),
    ).toEqual(["c"]);
    expect(Object.keys(initial)).toEqual(["a", "b"]);
  });
  it("never uses inherited properties as torrent entries", () => {
    const malicious = JSON.parse('{"__proto__":{"name":"bad"}}');
    const result = mergeMainData({}, { rid: 1, torrents: malicious });
    expect(Object.getPrototypeOf(result)).toBe(null);
    expect(({} as { name?: string }).name).toBeUndefined();
  });
});

describe("task selection", () => {
  it("combines search/category/tag/status and uses exact tag names", () => {
    const tasks = [
      torrent("a"),
      torrent("b", { tags: "Linux Mint" }),
      torrent("c", { state: "uploading" }),
    ];
    expect(
      filterTorrents(tasks, {
        search: " UBUNTU ",
        status: "downloading",
        category: "软件",
        tag: "Linux",
        sort: "name",
      }).map((t) => t.hash),
    ).toEqual(["a"]);
  });
  it("includes stopped tasks regardless of completion and sorts by actual size", () => {
    const tasks = [
      torrent("a", { state: "stoppedUP", size: 50 }),
      torrent("b", { state: "stoppedDL", size: 100 }),
    ];
    expect(
      filterTorrents(tasks, {
        search: "",
        status: "paused",
        category: "",
        tag: "",
        sort: "size",
      }).map((t) => t.hash),
    ).toEqual(["b", "a"]);
  });
  it("distinguishes stalled downloads, active seeding and missing files", () => {
    expect(statusOf("stalledDL").key).toBe("downloading");
    expect(statusOf("uploading").key).toBe("seeding");
    expect(statusOf("missingFiles").key).toBe("error");
  });
});

describe("human readable transfer data", () => {
  it("formats zero, nonfinite and binary sizes without NaN", () => {
    expect(bytes(0)).toBe("0 B");
    expect(bytes(1536)).toBe("1.5 KiB");
    expect(bytes(Number.NaN)).toBe("—");
    expect(duration(8640000)).toBe("∞");
    expect(duration(3661)).toBe("1 小时 1 分");
    expect(percent(1.4)).toBe("100%");
  });
});
