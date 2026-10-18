import type { Identity } from "./domain";
export const signedOutIdentity: Identity = {
  id: "",
  name: "",
  role: "viewer",
  workspace: "",
};
export function clearSession() {
  sessionStorage.removeItem("fc-token");
  sessionStorage.removeItem("fc-identity");
}
export function readSession(): { token: string; identity: Identity } | null {
  try {
    const token = sessionStorage.getItem("fc-token");
    const identity = JSON.parse(
      sessionStorage.getItem("fc-identity") || "null",
    );
    if (
      !token ||
      !identity ||
      typeof identity.id !== "string" ||
      !identity.id ||
      typeof identity.workspaceId !== "string" ||
      !identity.workspaceId ||
      typeof identity.name !== "string" ||
      typeof identity.workspace !== "string" ||
      !["owner", "dispatcher", "field", "viewer"].includes(identity.role)
    ) {
      clearSession();
      return null;
    }
    return { token, identity };
  } catch {
    clearSession();
    return null;
  }
}
