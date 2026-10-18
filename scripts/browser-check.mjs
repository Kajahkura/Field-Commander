import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const dir = process.env.FC_ARTIFACT_DIR || "verification";
await mkdir(dir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage(),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
let shared = [],
  mutations = [],
  loseReceipt = false,
  conflict = false,
  accessRevoked = false;
let identity = {
  id: "workspace-owner",
  name: "Workspace Owner",
  role: "owner",
  workspace: "Browser test workspace",
  workspaceId: "test-workspace",
  dbGeneration: "test-generation",
};
await context.route("**/_server_islands/operations", async (route) => {
  const v = route.request().postDataJSON();
  if (accessRevoked)
    return route.fulfill({ status: 401, json: { message: "Access revoked" } });
  if (v.action === "login")
    return route.fulfill({
      json: {
        identity,
        members: [{ ...identity, active: true }],
        providers: {},
      },
    });
  if (v.action === "state")
    return route.fulfill({ json: { entities: shared, cursor: "" } });
  if (v.action === "mutate") {
    mutations.push(v.operation);
    const entity = v.operation.entity;
    if (conflict) {
      conflict = false;
      const server = {
        ...entity,
        revision: entity.revision,
        title: "Shared concurrent title",
      };
      shared = shared.filter((r) => r.id !== entity.id).concat(server);
      return route.fulfill({
        status: 409,
        json: { message: "Shared record changed", entity: server },
      });
    }
    shared = shared
      .filter((r) => r.id !== entity.id)
      .concat({ ...entity, pending: false });
    if (loseReceipt) {
      loseReceipt = false;
      await context.setOffline(true);
      return route.abort("failed");
    }
    return route.fulfill({ json: { entity: { ...entity, pending: false } } });
  }
  return route.fulfill({
    status: 400,
    json: { error: "Unexpected test request" },
  });
});
await page.goto(process.env.FC_BASE_URL || "http://127.0.0.1:4317");
await page
  .getByRole("heading", { name: "Sign in to your workspace" })
  .waitFor();
assert.equal(
  await page.locator(".stat").count(),
  0,
  "Signed out users must not see workspace records",
);
await page.screenshot({
  path: `${dir}/sign-in.png`,
  fullPage: true,
  animations: "disabled",
});
await page.evaluate(async () => {
  await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller)
    await new Promise((r) =>
      navigator.serviceWorker.addEventListener("controllerchange", r, {
        once: true,
      }),
    );
});
await page
  .getByLabel("Your access key")
  .fill("browser-key-for-test-only-0000000000");
await page.getByRole("button", { name: "Sign in", exact: true }).click();
await page.getByText("Workspace Owner", { exact: true }).first().waitFor();
assert.equal(shared.length, 0, "New workspaces start empty");
await page.getByRole("button", { name: "New assignment" }).click();
await page.getByRole("heading", { name: "Add a destination first" }).waitFor();
await page.getByRole("button", { name: "Close dialog" }).click();
await page.getByRole("button", { name: "Sites & map", exact: true }).click();
await page.getByRole("button", { name: "Add site", exact: true }).click();
await page.getByLabel("Site name").fill("Receipt test site");
await page.getByRole("button", { name: "Save site", exact: true }).click();
await page.getByText("Receipt test site", { exact: true }).waitFor();
async function outbox(expected) {
  await page.waitForFunction(async (expected) => {
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open("field-commander-v1");
      r.onsuccess = () => resolve(r.result);
      r.onerror = reject;
    });
    const rows = await new Promise((resolve, reject) => {
      const r = db.transaction("outbox").objectStore("outbox").getAll();
      r.onsuccess = () => resolve(r.result);
      r.onerror = reject;
    });
    db.close();
    return rows.length === expected;
  }, expected);
}
await expect.poll(() => shared.length).toBe(1);
await outbox(0);
assert.equal(shared.length, 1);
await context.setOffline(true);
await page.getByRole("button", { name: "Assignments", exact: true }).click();
await page.getByRole("button", { name: "New assignment" }).click();
await page.getByLabel("Assignment title").fill("Offline real assignment");
await page.getByRole("button", { name: "Save assignment" }).click();
await outbox(1);
await page.reload();
await page.getByRole("button", { name: "Assignments", exact: true }).click();
await page.getByText("Offline real assignment", { exact: true }).waitFor();
assert.equal(shared.length, 1);
loseReceipt = true;
await context.setOffline(false);
await page
  .getByRole("button", { name: "Workspace settings", exact: true })
  .click();
await expect.poll(() => loseReceipt).toBe(false);
await outbox(1);
await context.setOffline(false);
await page.getByRole("button", { name: "Sync now", exact: true }).click();
await outbox(0);
const retry = mutations.filter(
  (op) => op.entity.title === "Offline real assignment",
);
assert.ok(retry.length >= 2);
assert.equal(
  retry[0].id,
  retry[1].id,
  "Lost receipt retry must preserve operation ID",
);
await page.getByRole("button", { name: "Assignments", exact: true }).click();
await page.getByText("Offline real assignment", { exact: true }).click();
await page
  .getByRole("button", { name: "Edit assignment", exact: true })
  .click();
await page.getByLabel("Assignment title").fill("My conflicting title");
conflict = true;
await page.getByRole("button", { name: "Save assignment" }).click();
await page
  .getByRole("button", { name: "Workspace settings", exact: true })
  .click();
await page.getByRole("button", { name: "Review conflict" }).waitFor();
await page.getByRole("button", { name: "Review conflict" }).click();
await page
  .getByRole("button", { name: "Use shared version", exact: true })
  .click();
await outbox(0);
await page.getByRole("button", { name: "Assignments", exact: true }).click();
await page.getByText("Shared concurrent title", { exact: true }).waitFor();
await page.screenshot({
  path: `${dir}/desktop.png`,
  fullPage: true,
  animations: "disabled",
});
await page.setViewportSize({ width: 390, height: 844 });
await page.screenshot({
  path: `${dir}/mobile.png`,
  fullPage: true,
  animations: "disabled",
});
assert.equal(
  await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  ),
  true,
  "Page must fit mobile width",
);
await page.getByRole("button", { name: "Open navigation" }).click();
await page
  .getByRole("button", { name: "Field intelligence", exact: true })
  .click();
await page
  .getByRole("heading", { name: "Field intelligence", exact: true })
  .waitFor();
assert.deepEqual(errors, []);
await page.setViewportSize({ width: 1440, height: 1000 });
await context.setOffline(true);
await page.getByRole("button", { name: "Assignments", exact: true }).click();
await page.getByRole("button", { name: "New assignment" }).click();
await page.getByLabel("Assignment title").fill("Retained pending work");
await page.getByRole("button", { name: "Save assignment" }).click();
await outbox(1);
accessRevoked = true;
await context.setOffline(false);
await page
  .getByRole("heading", { name: "Sign in to your workspace" })
  .waitFor();
assert.equal(
  await page.getByText("Retained pending work", { exact: true }).count(),
  0,
  "Revoked sessions must clear visible records",
);
await outbox(1);
accessRevoked = false;
shared = [];
identity = {
  ...identity,
  id: "other-owner",
  workspaceId: "other-workspace",
  workspace: "Other workspace",
};
await page
  .getByLabel("Your access key")
  .fill("other-browser-key-for-test-only-0000000");
await page.getByRole("button", { name: "Sign in", exact: true }).click();
await page.getByRole("heading", { name: /Good/ }).waitFor();
assert.equal(
  await page.getByText("Retained pending work", { exact: true }).count(),
  0,
  "A different workspace must not display previous pending work",
);
await outbox(1);
console.log(
  "PASS: public shell offline reload, persistent offline saves, signed-out isolation, receipt retries, conflict recovery, mobile navigation and width, revoked access, account isolation, no browser runtime errors. API responses supplied by a local protocol fixture; live backend verification is separate.",
);
await browser.close();
