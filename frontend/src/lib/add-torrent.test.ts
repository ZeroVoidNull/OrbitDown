import { describe, expect, it } from "vitest";
import { addOptions, validTorrentLinks } from "./add-torrent";
describe("native torrent addition", () => {
  it("accepts magnets and HTTP torrent links but rejects credentials and other protocols", () => {
    expect(
      validTorrentLinks(
        "magnet:?xt=urn:btih:abc\nhttps://example.org/a.torrent",
      ),
    ).toBe(true);
    expect(validTorrentLinks("ftp://example.org/a.torrent")).toBe(false);
    expect(validTorrentLinks("https://user:pass@example.org/a")).toBe(false);
  });
  it("leaves untouched native defaults absent and converts explicit limits", () => {
    expect(addOptions({})).toEqual({});
    expect(
      addOptions({
        dlLimit: "12.5",
        ratioLimit: "-2",
        stopped: false,
        contentLayout: "Subfolder",
      }),
    ).toEqual({
      dlLimit: "12800",
      ratioLimit: "-2",
      stopped: "false",
      contentLayout: "Subfolder",
    });
    expect(() => addOptions({ seedingTimeLimit: "1.5" })).toThrow();
    expect(() => addOptions({ upLimit: "-1" })).toThrow();
  });
});
