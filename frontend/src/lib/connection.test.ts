import { describe, expect, it } from "vitest";
import {
  canRetainConnectionPassword,
  connectionEndpointError,
  connectionValidationError,
  joinConnectionAddress,
  splitConnectionUrl,
  type ConnectionInfo,
} from "./connection";

const saved: ConnectionInfo = {
  configured: true,
  url: "http://nas.local:8080",
  username: "admin",
  password_saved: true,
};

describe("qBittorrent connection credentials", () => {
  it("retains a saved password only for the unchanged saved target and user", () => {
    expect(canRetainConnectionPassword(saved, saved.url, "admin")).toBe(true);
    expect(
      canRetainConnectionPassword(
        saved,
        " http://nas.local:8080/// ",
        " admin ",
      ),
    ).toBe(true);
    expect(
      canRetainConnectionPassword(saved, "http://other.local:8080", "admin"),
    ).toBe(false);
    expect(canRetainConnectionPassword(saved, saved.url, "other")).toBe(false);
    expect(
      canRetainConnectionPassword(
        { ...saved, password_saved: false },
        saved.url,
        "admin",
      ),
    ).toBe(false);
    expect(
      canRetainConnectionPassword(
        { ...saved, configured: false },
        saved.url,
        "admin",
      ),
    ).toBe(false);
    expect(canRetainConnectionPassword(null, saved.url, "admin")).toBe(false);
  });

  it("requires a password when changing the target or username", () => {
    expect(
      connectionValidationError(saved, {
        url: saved.url,
        username: "admin",
        password: "",
      }),
    ).toBe("");
    expect(
      connectionValidationError(saved, {
        url: "http://other.local:8080",
        username: "admin",
        password: "",
      }),
    ).toBeTruthy();
    expect(
      connectionValidationError(saved, {
        url: saved.url,
        username: "new-admin",
        password: "",
      }),
    ).toBeTruthy();
    expect(
      connectionValidationError(null, {
        url: saved.url,
        username: "admin",
        password: "",
      }),
    ).toBeTruthy();
    expect(
      connectionValidationError(saved, {
        url: "http://other.local:8080",
        username: "admin",
        password: "new-secret",
      }),
    ).toBe("");
  });

  it("rejects missing names and unsafe WebUI addresses before making a request", () => {
    for (const url of [
      "",
      "not-a-url",
      "http:nas.local",
      "ftp://nas.local",
      "http://user:secret@nas.local",
      "http://nas.local/#fragment",
      "http://nas.local/?token=secret",
    ]) {
      expect(
        connectionValidationError(saved, {
          url,
          username: "admin",
          password: "secret",
        }),
      ).toBeTruthy();
    }
    expect(
      connectionValidationError(saved, {
        url: saved.url,
        username: "   ",
        password: "secret",
      }),
    ).toBeTruthy();
    expect(
      connectionValidationError(null, {
        url: "https://nas.local/qbt",
        username: "admin",
        password: "secret",
      }),
    ).toBe("");
  });
});

describe("connection endpoint split and join", () => {
  it("splits a stored URL back into host and port", () => {
    expect(splitConnectionUrl("http://10.31.0.66:8085")).toEqual({
      address: "10.31.0.66",
      port: "8085",
    });
    expect(splitConnectionUrl("http://nas.local:8080/x")).toEqual({
      address: "nas.local",
      port: "8080",
    });
    expect(splitConnectionUrl("not a url")).toEqual({
      address: "not a url",
      port: "",
    });
  });

  it("joins address and port into an http URL", () => {
    expect(joinConnectionAddress(" 10.31.0.66 ", " 8085 ")).toBe(
      "http://10.31.0.66:8085",
    );
  });

  it("validates host and port fields separately", () => {
    expect(connectionEndpointError("10.31.0.66", "8085")).toBe("");
    expect(connectionEndpointError("", "8085")).toContain("服务器地址");
    expect(connectionEndpointError("http://10.31.0.66", "8085")).toContain(
      "主机名或 IP",
    );
    expect(connectionEndpointError("10.31.0.66:8085", "8085")).toContain(
      "主机名或 IP",
    );
    expect(connectionEndpointError("10.31.0.66", "")).toContain("端口");
    expect(connectionEndpointError("10.31.0.66", "99999")).toContain("端口");
    expect(connectionEndpointError("10.31.0.66", "abc")).toContain("端口");
  });
});
