import type { Entity, Identity, Member, Operation, Weather } from "./domain";
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public data?: any,
  ) {
    super(message);
  }
}
export async function call<T = any>(
  action: string,
  data: Record<string, unknown> = {},
  token = sessionStorage.getItem("fc-token") || "",
): Promise<T> {
  const res = await fetch("/_server_islands/operations", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ action, ...data }),
    signal: AbortSignal.timeout(25000),
    cache: "no-store",
  });
  let body: any;
  try {
    body = await res.json();
  } catch {
    throw new ApiError(
      res.status,
      "The service is unavailable. Your saved work remains on this device.",
    );
  }
  if (!res.ok || body.error)
    throw new ApiError(
      res.status,
      body.message || body.error || "Request failed",
      body,
    );
  return body;
}
export const login = (token: string) =>
  call<{
    identity: Identity;
    members: Member[];
    providers: Record<string, boolean>;
  }>("login", {}, token);
export async function pull(token?: string) {
  const rows: Entity[] = [];
  let cursor = "";
  for (let page = 0; page < 5000; page++) {
    const res = await call<{ entities: Entity[]; cursor: string }>(
      "state",
      {
        cursor,
      },
      token,
    );
    rows.push(...res.entities);
    if (!res.cursor) return rows;
    cursor = res.cursor;
  }
  throw new Error(
    "This workspace is too large to download in one session. Contact the owner.",
  );
}
export const push = (op: Operation, token?: string) =>
  call<{ entity: Entity }>("mutate", { operation: op }, token);
export const getWeather = (lat: number, lon: number, provider = "met") =>
  call<Weather>("weather", { lat, lon, provider });
