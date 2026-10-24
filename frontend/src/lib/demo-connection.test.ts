import { afterEach, beforeEach, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("window", {
    location: { origin: "http://localhost", search: "?demo=1" },
    dispatchEvent: vi.fn(),
  });
});
afterEach(() => vi.unstubAllGlobals());

it("exposes a demo connection without leaking the password", async () => {
  const { readConnection } = await import("./qbit");
  expect(await readConnection()).toEqual({
    configured: true,
    url: "http://nas.local:8080",
    username: "admin",
    password_saved: true,
  });
});

it("authenticates any credentials except the documented wrong password", async () => {
  const { authenticate } = await import("./qbit");
  const result = await authenticate("http://nas.local:8080", "admin", "demo");
  expect(result).toEqual({ version: "v5.1.2", sid: "demo-sid" });
  await expect(
    authenticate("http://nas.local:8080", "admin", "wrong"),
  ).rejects.toMatchObject({ status: 401 });
});

it("updates the demo connection on save and clears it on erase", async () => {
  const { readConnection, writeConnection, eraseConnection } = await import(
    "./qbit"
  );
  await writeConnection({
    url: " https://new.local/qbt/ ",
    username: " new ",
    password: "secret",
  });
  expect(await readConnection()).toEqual({
    configured: true,
    url: "https://new.local/qbt",
    username: "new",
    password_saved: true,
  });
  await eraseConnection("new");
  expect((await readConnection()).configured).toBe(false);
});
