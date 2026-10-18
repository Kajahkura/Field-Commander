import { useCallback, useEffect, useRef, useState } from "react";
import * as store from "./data";
import * as api from "./api";
import {
  type Entity,
  type Identity,
  type Member,
  type Operation,
  exportFile,
} from "./domain";
import { readSession, clearSession, signedOutIdentity } from "./session";

export function useWorkspace() {
  const [identity, setIdentity] = useState<Identity>(
    () => readSession()?.identity || signedOutIdentity,
  );
  const [members, setMembers] = useState<Member[]>([]);
  const [rows, setRows] = useState<Entity[]>([]);
  const [pending, setPending] = useState<Operation[]>([]);
  const [online, setOnline] = useState(navigator.onLine);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [providers, setProviders] = useState<Record<string, boolean>>({});
  const [lastSync, setLastSync] = useState("");
  const [loaded, setLoaded] = useState(false);
  const authenticated = !!identity.workspaceId;
  const scope = authenticated ? `${identity.workspaceId}:${identity.id}` : "";
  const current = useRef(scope);
  current.current = scope;
  const lock = useRef<string | null>(null);
  const sessionVersion = useRef(0);

  const refresh = useCallback(async () => {
    if (!scope) return;
    const [records, operations] = await Promise.all([
      store.entities(scope),
      store.outbox(scope),
    ]);
    if (current.current === scope) {
      setRows(records.filter((x) => !x.deleted));
      setPending(operations);
    }
  }, [scope]);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    if (!scope) {
      setLoaded(true);
      return;
    }
    refresh()
      .then(() => {
        if (!cancelled) setLoaded(true);
      })
      .catch((e) => {
        if (!cancelled) setMessage(`Device storage unavailable: ${e.message}`);
      });
    return () => {
      cancelled = true;
    };
  }, [scope, refresh]);

  const expire = useCallback(() => {
    sessionVersion.current++;
    clearSession();
    current.current = "";
    setIdentity(signedOutIdentity);
    setRows([]);
    setPending([]);
    setMembers([]);
    setProviders({});
    setLastSync("");
    setBusy(false);
    setMessage(
      "Your access has expired or been revoked. Sign in again. Unsynced work is retained on this device.",
    );
  }, []);

  const sync = useCallback(
    async (retryErrors = true) => {
      const token = sessionStorage.getItem("fc-token");
      if (!scope || !token || !navigator.onLine || lock.current) return;
      const syncScope = scope;
      lock.current = syncScope;
      setBusy(true);
      setMessage("");
      try {
        const operations = await store.outbox(syncScope);
        const blocked = new Set<string>();
        for (const op of operations) {
          if (current.current !== syncScope) return;
          if (
            blocked.has(op.entity.id) ||
            (op.entity.kind === "photo" && blocked.has(op.entity.reportId)) ||
            op.status === "conflict" ||
            (op.status === "error" && !retryErrors)
          ) {
            blocked.add(op.entity.id);
            continue;
          }
          try {
            const res = await api.push(op, token);
            await store.acknowledge(syncScope, op, res.entity);
          } catch (e) {
            if (e instanceof api.ApiError && e.status === 409) {
              await store.mark(syncScope, {
                ...op,
                status: "conflict",
                server: e.data?.entity,
                message: e.message,
              });
              blocked.add(op.entity.id);
              continue;
            }
            if (
              e instanceof api.ApiError &&
              [400, 403, 422].includes(e.status)
            ) {
              await store.mark(syncScope, {
                ...op,
                status: "error",
                message: e.message,
              });
              blocked.add(op.entity.id);
              continue;
            }
            throw e;
          }
        }
        if (current.current !== syncScope) return;
        const records = await api.pull(token);
        if (current.current !== syncScope) return;
        await store.reconcile(syncScope, records);
        setLastSync(new Date().toISOString());
        await refresh();
        const remaining = await store.outbox(syncScope);
        if (current.current === syncScope)
          setMessage(
            remaining.length
              ? `${remaining.length} changes still need attention or a server receipt. Review the device queue in settings.`
              : "Workspace refreshed. All device changes have server receipts.",
          );
      } catch (e) {
        if (current.current !== syncScope) return;
        if (e instanceof api.ApiError && e.status === 401) expire();
        else {
          setMessage((e as Error).message);
          await refresh();
        }
      } finally {
        lock.current = null;
        if (current.current === syncScope) setBusy(false);
      }
    },
    [scope, refresh, expire],
  );

  useEffect(() => {
    const on = () => setOnline(true),
      off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  useEffect(() => {
    if (!loaded || !online || !authenticated) return;
    void sync(false);
    const timer = setInterval(() => void sync(false), 45000);
    return () => clearInterval(timer);
  }, [loaded, online, authenticated, sync]);

  async function connect(key: string) {
    if (lock.current) throw new Error("Wait for the current sync to finish.");
    const version = ++sessionVersion.current;
    const res = await api.login(key);
    if (version !== sessionVersion.current) return;
    sessionStorage.setItem("fc-token", key);
    sessionStorage.setItem("fc-identity", JSON.stringify(res.identity));
    current.current = `${res.identity.workspaceId}:${res.identity.id}`;
    setRows([]);
    setPending([]);
    setLastSync("");
    setIdentity(res.identity);
    setMembers(res.members);
    setProviders(res.providers);
    setMessage("");
  }

  useEffect(() => {
    const saved = readSession();
    if (!saved || !online) return;
    const version = sessionVersion.current;
    api
      .login(saved.token)
      .then((r) => {
        if (version !== sessionVersion.current) return;
        setIdentity(r.identity);
        setMembers(r.members);
        setProviders(r.providers);
        sessionStorage.setItem("fc-identity", JSON.stringify(r.identity));
      })
      .catch((e) => {
        if (version !== sessionVersion.current) return;
        if (e instanceof api.ApiError && [401, 403].includes(e.status))
          expire();
        else
          setMessage(
            "Unable to verify access right now. Previously saved workspace records remain available on this device.",
          );
      });
  }, [online, expire]);

  async function save(entity: Entity) {
    if (!authenticated)
      throw new Error("Sign in before saving workspace records.");
    const expected = entity.revision;
    const e = {
      ...entity,
      revision: expected + 1,
      updatedAt: new Date().toISOString(),
    };
    await store.queue(scope, {
      id: crypto.randomUUID(),
      entity: e,
      expectedRevision: expected,
      expectedGeneration: identity.dbGeneration,
      createdAt: new Date().toISOString(),
      status: "queued",
    });
    setMessage("Saved on this device. Waiting for a server receipt.");
    await refresh();
  }

  useEffect(() => {
    if (
      pending.some((op) => op.status === "queued") &&
      online &&
      authenticated &&
      !busy
    ) {
      const timer = setTimeout(() => void sync(false), 700);
      return () => clearTimeout(timer);
    }
  }, [pending, online, authenticated, busy, sync]);

  async function resolve(op: Operation, local: boolean) {
    await store.resolve(scope, op, local);
    await refresh();
    void sync();
  }
  async function disconnect() {
    sessionVersion.current++;
    clearSession();
    current.current = "";
    setIdentity(signedOutIdentity);
    setRows([]);
    setPending([]);
    setMembers([]);
    setProviders({});
    setLastSync("");
    setBusy(false);
    setMessage("Signed out. Your saved work remains on this device.");
  }
  function backup() {
    exportFile(
      "field-commander-backup.json",
      JSON.stringify(
        {
          version: 1,
          workspace: identity.workspace,
          exportedAt: new Date().toISOString(),
          entities: rows,
          operations: pending,
        },
        null,
        2,
      ),
    );
  }
  return {
    identity,
    members,
    setMembers,
    rows,
    pending,
    online,
    busy,
    message,
    setMessage,
    providers,
    lastSync,
    loaded,
    authenticated,
    scope,
    refresh,
    sync,
    connect,
    save,
    resolve,
    disconnect,
    backup,
  };
}
