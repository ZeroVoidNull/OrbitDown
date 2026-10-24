import { afterEach, beforeEach, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("window", {
    location: { search: "" },
    dispatchEvent: vi.fn(),
  });
});
afterEach(() => vi.unstubAllGlobals());

it("authenticates with qBittorrent and enforces the 5.x version check", async () => {
  const calls: [string, RequestInit | undefined][] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, init?: RequestInit) => {
      calls.push([path, init]);
      if (path.endsWith("/api/v2/auth/login"))
        return new Response("Ok.", {
          headers: { "set-cookie": "SID=abc123; path=/" },
        });
      return new Response("v5.1.2");
    }),
  );
  const { authenticate } = await import("./qbit");
  const result = await authenticate(
    "http://192.168.1.10:8080/",
    "admin",
    "secret",
  );
  expect(result).toEqual({ version: "v5.1.2", sid: "abc123" });
  expect(calls[0]![1]!.body).toBe(
    new URLSearchParams({ username: "admin", password: "secret" }).toString(),
  );
});

it("rejects wrong credentials, unreachable hosts and unsupported versions", async () => {
  const { authenticate } = await import("./qbit");
  const { APIError } = await import("./transport");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) => {
      if (path.endsWith("/auth/login")) return new Response("Fails.", { status: 403 });
      return new Response("Ok.");
    }),
  );
  await expect(authenticate("http://qbit", "admin", "bad")).rejects.toMatchObject(
    { status: 403 },
  );
  vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("offline"))));
  await expect(authenticate("http://qbit", "admin", "secret")).rejects.toBeInstanceOf(
    APIError,
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) => {
      if (path.endsWith("/auth/login"))
        return new Response("Ok.", { headers: { "set-cookie": "SID=x" } });
      return new Response("v4.6.0");
    }),
  );
  await expect(authenticate("http://qbit", "admin", "secret")).rejects.toMatchObject({
    status: 400,
  });
});

it("retries once through relogin after a 403 and signals unauthorized when it fails", async () => {
  const sids = ["stale", "fresh"];
  const loginBodies: string[] = [];
  let first = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, init?: RequestInit) => {
      if (path.endsWith("/auth/login")) {
        loginBodies.push(String(init?.body));
        return new Response("Ok.", {
          headers: { "set-cookie": `SID=${sids.shift()}; path=/` },
        });
      }
      if (path.endsWith("/app/version")) return new Response("v5.1.2");
      if (first) {
        first = false;
        return new Response("forbidden", { status: 403 });
      }
      return new Response("Ok.");
    }),
  );
  const qbit = await import("./qbit");
  qbit.adoptSession("http://qbit", "admin", "stale", "secret");
  const response = await qbit.authFetch("/api/v2/torrents/info");
  expect(response.status).toBe(200);
  expect(loginBodies).toHaveLength(1);
  expect(response.headers).toBeTruthy();
  // 重登后再次 403 → 派发 unauthorized
  const always403 = vi.fn(async () => new Response("banned", { status: 403 }));
  vi.stubGlobal("fetch", always403);
  const forbidden = await qbit.authFetch("/api/v2/torrents/info");
  expect(forbidden.status).toBe(403);
  expect(window.dispatchEvent).toHaveBeenCalled();
  const event = (window.dispatchEvent as ReturnType<typeof vi.fn>).mock
    .calls[0]![0] as Event;
  expect(event.type).toBe("orbitdown:unauthorized");
});

it("sends the session cookie on regular requests and parses JSON responses", async () => {
  const headers: Headers[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_path: string, init?: RequestInit) => {
      headers.push(new Headers(init?.headers));
      return new Response('{"rid":1,"full_update":true}');
    }),
  );
  const qbit = await import("./qbit");
  const { api } = await import("./api");
  qbit.adoptSession("http://qbit", "admin", "sid42", "secret");
  const data = await api.get("/api/v2/sync/maindata?rid=0");
  expect(data).toEqual({ rid: 1, full_update: true });
  expect(headers[0]!.get("Cookie")).toBe("SID=sid42");
});
