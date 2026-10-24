import { describe, it, expect } from "vitest";
import {
  fieldsFor,
  preferencePatch,
  displayValue,
  apiValue,
} from "./preferences";

describe("complete native preference editing", () => {
  it("exposes every returned preference, including supported future fields", () => {
    const fields = fieldsFor({
      dht: true,
      listen_port: 6881,
      experimental_feature: false,
      scan_dirs: { "/watch": 1 },
      proxy_password: "",
      _orbitdown: {
        masked_fields: ["proxy_password"],
        configured_fields: ["proxy_password"],
      },
    });
    expect(fields.map((f) => f.key).sort()).toEqual([
      "dht",
      "experimental_feature",
      "listen_port",
      "proxy_password",
      "scan_dirs",
    ]);
    expect(fields.find((f) => f.key === "scan_dirs")?.type).toBe("folders");
    expect(fields.find((f) => f.key === "proxy_password")?.secret).toBe(true);
  });
  it("submits only changed values and preserves masked passwords", () => {
    const original = {
      dht: true,
      dl_limit: 8192,
      proxy_password: "",
      save_path: "/downloads",
    };
    expect(preferencePatch(original, { ...original, dht: false })).toEqual({
      dht: false,
    });
    expect(
      preferencePatch(original, {
        ...original,
        proxy_password: "new-password",
      }),
    ).toEqual({ proxy_password: "new-password" });
    expect(
      preferencePatch(original, { ...original }, new Set(["proxy_password"])),
    ).toEqual({ proxy_password: "" });
  });
  it("preserves sentinels and converts binary limits without changing untouched values", () => {
    expect(displayValue(1048576, { scale: 1024 })).toBe(1024);
    expect(apiValue("1024", { scale: 1024 }, 1048576)).toBe(1048576);
    expect(displayValue(-1, { scale: 1024 })).toBe(-1);
    expect(apiValue("-1", { scale: 1024 }, -1)).toBe(-1);
    expect(apiValue("2", {}, 0)).toBe(2);
    expect(apiValue("Subfolder", {}, "Original")).toBe("Subfolder");
  });
  it("does not turn reordered directory mappings into unwanted writes", () => {
    expect(
      preferencePatch(
        { scan_dirs: { "/a": 0, "/b": 1 } },
        { scan_dirs: { "/b": 1, "/a": 0 } },
      ),
    ).toEqual({});
  });
});

it("uses native string proxy enums instead of obsolete numeric values", () => {
  const proxy = fieldsFor({ proxy_type: "None" }).find(
    (f) => f.key === "proxy_type",
  )!;
  expect(proxy.options?.map((option) => option.value)).toEqual([
    "None",
    "SOCKS4",
    "SOCKS5",
    "HTTP",
  ]);
});

it("clears an old bound IP only when the user changes its network interface", async () => {
  const { setPreferenceValue } = await import("./preferences");
  const draft = {
    current_network_interface: "eth0",
    current_interface_address: "192.168.1.2",
    dht: true,
  };
  setPreferenceValue(draft, "dht", false);
  expect(draft.current_interface_address).toBe("192.168.1.2");
  setPreferenceValue(draft, "current_network_interface", "eth0");
  expect(draft.current_interface_address).toBe("192.168.1.2");
  setPreferenceValue(draft, "current_network_interface", "tun0");
  expect(draft.current_interface_address).toBe("");
});
