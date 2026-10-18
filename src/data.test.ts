import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import * as store from "./data";
import type { Site, Operation } from "./domain";
const site = (revision = 1, name = "Site"): Site => ({
  id: "site",
  kind: "site",
  revision,
  name,
  lat: 1,
  lon: 1,
  address: "",
  entrance: "",
  contact: "",
  notes: "",
  updatedAt: new Date().toISOString(),
});
const operation = (entity: Site, id = crypto.randomUUID()): Operation => ({
  id,
  entity,
  expectedRevision: entity.revision - 1,
  expectedGeneration: "generation",
  status: "queued",
  createdAt: new Date().toISOString(),
});
describe("offline workspace storage", () => {
  it("keeps records and pending work isolated by workspace and member", async () => {
    const a = "isolation:alice",
      b = "isolation:bob";
    await store.queue(a, operation(site()));
    expect(await store.entities(b)).toEqual([]);
    expect(await store.outbox(b)).toEqual([]);
    await store.reconcile(b, [site(1, "Other site")]);
    await store.clearScope(a);
    expect(await store.entities(a)).toEqual([]);
    expect(await store.outbox(a)).toEqual([]);
    expect((await store.entities(b))[0]).toMatchObject({name: "Other site"});
  });
  it("does not overwrite later offline edits when an earlier receipt arrives", async () => {
    const scope = "receipts:member",
      first = operation(site(1, "First")),
      later = operation(site(2, "Later"));
    await store.queue(scope, first);
    await store.queue(scope, later);
    await store.acknowledge(scope, first, first.entity);
    expect((await store.entities(scope))[0]).toMatchObject({
      name: "Later",
      pending: true,
    });
    expect((await store.outbox(scope)).map((op) => op.id)).toEqual([later.id]);
    await store.acknowledge(scope, later, later.entity);
    expect((await store.entities(scope))[0].pending).toBe(false);
  });
  it("reconciles a complete shared snapshot while retaining unsynced edits", async () => {
    const scope = "reconcile:member";
    await store.reconcile(scope, [
      site(1, "Shared"),
      { ...site(), id: "absent" },
    ]);
    await store.queue(scope, operation(site(2, "Local")));
    await store.reconcile(scope, [site(3, "Remote")]);
    expect(await store.entities(scope)).toHaveLength(1);
    expect((await store.entities(scope))[0]).toMatchObject({name: "Local"});
  });
  it("rebases the latest local edit with a fresh operation ID when resolving a conflict", async () => {
    const scope = "conflict:member";
    const first = operation(site(2, "First"));
    await store.queue(scope, first);
    await store.queue(scope, operation(site(3, "Latest")));
    await store.resolve(
      scope,
      { ...first, status: "conflict", server: site(4, "Shared") },
      true,
    );
    const ops = await store.outbox(scope);
    expect(ops).toHaveLength(1);
    expect(ops[0].id).not.toBe(first.id);
    expect(ops[0]).toMatchObject({
      expectedRevision: 4,
      status: "queued",
      entity: { revision: 5, name: "Latest" },
    });
    expect((await store.entities(scope))[0]).toMatchObject({
      name: "Latest",
      pending: true,
    });
  });
});
