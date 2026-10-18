import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearSession, readSession } from "./session";
const values = new Map<string, string>();
vi.stubGlobal("sessionStorage", {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => values.set(key, value),
  removeItem: (key: string) => values.delete(key),
});
beforeEach(() => values.clear());
describe("workspace sessions", () => {
  it("starts signed out without credentials", () =>
    expect(readSession()).toBeNull());
  it("clears incomplete or corrupt identities rather than opening a workspace", () => {
    values.set("fc-token", "test-key");
    values.set("fc-identity", "{");
    expect(readSession()).toBeNull();
    expect(values.size).toBe(0);
    values.set("fc-token", "test-key");
    values.set("fc-identity", JSON.stringify({ id: "member", role: "owner" }));
    expect(readSession()).toBeNull();
    expect(values.size).toBe(0);
  });
  it("restores a complete scoped session and clears credentials at sign out", () => {
    const identity = {
      id: "member",
      workspaceId: "workspace",
      workspace: "Team",
      name: "Member",
      role: "field",
    };
    values.set("fc-token", "test-key");
    values.set("fc-identity", JSON.stringify(identity));
    expect(readSession()).toEqual({ token: "test-key", identity });
    clearSession();
    expect(readSession()).toBeNull();
  });
});
