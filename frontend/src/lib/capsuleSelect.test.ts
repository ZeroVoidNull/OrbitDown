import { describe, expect, it } from "vitest";
import { nextOptionIndex, findOptionByPrefix } from "./capsuleSelect";

describe("capsule select keyboard navigation", () => {
  it("wraps arrow navigation and supports first/last options", () => {
    expect(nextOptionIndex(2, "ArrowDown", 3)).toBe(0);
    expect(nextOptionIndex(0, "ArrowUp", 3)).toBe(2);
    expect(nextOptionIndex(-1, "ArrowDown", 3)).toBe(0);
    expect(nextOptionIndex(-1, "ArrowUp", 3)).toBe(2);
    expect(nextOptionIndex(1, "Home", 3)).toBe(0);
    expect(nextOptionIndex(1, "End", 3)).toBe(2);
    expect(nextOptionIndex(0, "ArrowDown", 0)).toBe(-1);
  });
  it("finds labels by prefix after the active option, including wraparound", () => {
    const labels = ["HTTP", "SOCKS4", "SOCKS5", "系统默认"];
    expect(findOptionByPrefix(labels, "s", 0)).toBe(1);
    expect(findOptionByPrefix(labels, "s", 1)).toBe(2);
    expect(findOptionByPrefix(labels, "SOCKS4", 1)).toBe(1);
    expect(findOptionByPrefix(labels, "系统", 2)).toBe(3);
    expect(findOptionByPrefix(labels, "unknown", 1)).toBe(-1);
  });
});
