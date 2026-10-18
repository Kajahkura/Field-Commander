import { openDB, type DBSchema } from "idb";
import type { Entity, Operation } from "./domain";
interface Store extends DBSchema {
  entities: {
    key: string;
    value: { key: string; scope: string; entity: Entity };
    indexes: { scope: string };
  };
  outbox: {
    key: string;
    value: Operation & { scope: string };
    indexes: { scope: string };
  };
  meta: { key: string; value: unknown };
}
const db = openDB<Store>("field-commander-v1", 1, {
  upgrade(d) {
    const e = d.createObjectStore("entities", { keyPath: "key" });
    e.createIndex("scope", "scope");
    const o = d.createObjectStore("outbox", { keyPath: "id" });
    o.createIndex("scope", "scope");
    d.createObjectStore("meta");
  },
});
export async function entities(scope: string) {
  return (await (await db).getAllFromIndex("entities", "scope", scope)).map(
    (r) => r.entity,
  );
}
export async function outbox(scope: string) {
  return (await (await db).getAllFromIndex("outbox", "scope", scope)).sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt),
  );
}
export async function queue(scope: string, op: Operation) {
  const d = await db;
  const tx = d.transaction(["entities", "outbox"], "readwrite");
  await tx.objectStore("entities").put({
    key: `${scope}:${op.entity.id}`,
    scope,
    entity: { ...op.entity, pending: true },
  });
  await tx.objectStore("outbox").put({ ...op, scope });
  await tx.done;
}
export async function reconcile(scope: string, rows: Entity[]) {
  const d = await db;
  const tx = d.transaction(["entities", "outbox"], "readwrite");
  const pending = await tx.objectStore("outbox").index("scope").getAll(scope);
  const ids = new Set(pending.map((op) => op.entity.id));
  const remoteIds = new Set(rows.map((row) => row.id));
  for (const row of await tx
    .objectStore("entities")
    .index("scope")
    .getAll(scope)) {
    if (!ids.has(row.entity.id) && !remoteIds.has(row.entity.id))
      await tx.objectStore("entities").delete(row.key);
  }
  for (const entity of rows) {
    if (!ids.has(entity.id))
      await tx
        .objectStore("entities")
        .put({ key: `${scope}:${entity.id}`, scope, entity });
  }
  await tx.done;
}
export async function acknowledge(
  scope: string,
  op: Operation,
  server: Entity,
) {
  const d = await db;
  const tx = d.transaction(["outbox", "entities"], "readwrite");
  await tx.objectStore("outbox").delete(op.id);
  const later = (
    await tx.objectStore("outbox").index("scope").getAll(scope)
  ).filter((o) => o.entity.id === op.entity.id);
  if (!later.length)
    await tx.objectStore("entities").put({
      key: `${scope}:${server.id}`,
      scope,
      entity: { ...server, pending: false },
    });
  await tx.done;
}
export async function mark(scope: string, op: Operation) {
  await (await db).put("outbox", { ...op, scope });
}
export async function resolve(
  scope: string,
  op: Operation,
  keepLocal: boolean,
) {
  const d = await db;
  if (!op.server)
    throw new Error(
      "The shared version is unavailable. Export pending work and contact your workspace owner.",
    );
  const tx = d.transaction(["outbox", "entities"], "readwrite");
  const all = await tx.objectStore("outbox").index("scope").getAll(scope);
  const matching = all
    .filter((item) => item.entity.id === op.entity.id)
    .sort((a, b) => a.entity.revision - b.entity.revision);
  const local = matching.at(-1)?.entity || op.entity;
  for (const item of matching) await tx.objectStore("outbox").delete(item.id);
  const entity = keepLocal
    ? {
        ...local,
        revision: op.server.revision + 1,
        updatedAt: new Date().toISOString(),
        pending: true,
      }
    : { ...op.server, pending: false };
  await tx
    .objectStore("entities")
    .put({ key: `${scope}:${op.entity.id}`, scope, entity });
  if (keepLocal)
    await tx
      .objectStore("outbox")
      .put({
        ...op,
        scope,
        id: crypto.randomUUID(),
        entity: { ...entity, pending: undefined },
        expectedRevision: op.server.revision,
        createdAt: new Date().toISOString(),
        status: "queued",
        message: undefined,
        server: undefined,
      });
  await tx.done;
}
export async function meta(key: string, value?: unknown) {
  const d = await db;
  if (value !== undefined) {
    await d.put("meta", value, key);
    return value;
  }
  return d.get("meta", key);
}
export async function clearScope(scope: string) {
  const d = await db;
  const tx = d.transaction(["entities", "outbox", "meta"], "readwrite");
  for (const e of await tx.objectStore("entities").index("scope").getAll(scope))
    await tx.objectStore("entities").delete(e.key);
  for (const o of await tx.objectStore("outbox").index("scope").getAll(scope))
    await tx.objectStore("outbox").delete(o.id);
  for (const key of await tx.objectStore("meta").getAllKeys())
    if (key.startsWith(`weather:${scope}:`))
      await tx.objectStore("meta").delete(key);
  await tx.done;
}
