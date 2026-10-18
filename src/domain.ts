export type Role = "owner" | "dispatcher" | "field" | "viewer";
export type Kind = "job" | "site" | "report" | "photo";
export type Status =
  | "planned"
  | "assigned"
  | "in-progress"
  | "completed"
  | "failed";
export type Severity = "info" | "caution" | "blocked";
export interface Identity {
  id: string;
  name: string;
  role: Role;
  workspace: string;
  workspaceId?: string;
  dbGeneration?: string;
}
export interface Member {
  id: string;
  name: string;
  role: Role;
  active: boolean;
}
export interface Base {
  id: string;
  kind: Kind;
  revision: number;
  updatedAt: string;
  deleted?: boolean;
  pending?: boolean;
}
export interface Site extends Base {
  kind: "site";
  name: string;
  lat: number;
  lon: number;
  address: string;
  entrance: string;
  contact: string;
  notes: string;
}
export interface Evidence {
  reportId: string;
  title: string;
  severity: Severity;
  observedAt: string;
  expiresAt: string;
  vehicle: string;
  verified: boolean;
}
export interface Job extends Base {
  kind: "job";
  title: string;
  siteId: string;
  assigneeId: string;
  status: Status;
  priority: "normal" | "high";
  dueAt: string;
  vehicle: string;
  notes: string;
  outcome: string;
  evidence: Evidence[];
  plannedAt: string;
  weatherBrief?: string;
}
export interface Report extends Base {
  kind: "report";
  title: string;
  siteId: string;
  severity: Severity;
  category: "road" | "crossing" | "entrance" | "weather" | "other";
  observedAt: string;
  expiresAt: string;
  vehicle: string;
  notes: string;
  authorId: string;
  verified: boolean;
  lat?: number;
  lon?: number;
}
export interface Photo extends Base {
  kind: "photo";
  reportId: string;
  data: string;
  caption: string;
}
export type Entity = Site | Job | Report | Photo;
export interface Operation {
  id: string;
  entity: Entity;
  expectedRevision: number;
  expectedGeneration?: string;
  createdAt: string;
  status: "queued" | "conflict" | "error";
  message?: string;
  server?: Entity;
}
export interface WeatherPoint {
  time: string;
  temperature: number;
  humidity?: number;
  rain: number | null;
  wind: number;
  symbol: string;
}
export interface Weather {
  provider: string;
  fetchedAt: string;
  points: WeatherPoint[];
  cached?: boolean;
}
export const statusLabels: Record<Status, string> = {
  planned: "Planned",
  assigned: "Assigned",
  "in-progress": "In progress",
  completed: "Completed",
  failed: "Could not complete",
};
export const uid = () => crypto.randomUUID();
export function distance(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
) {
  const rad = Math.PI / 180,
    dlat = (b.lat - a.lat) * rad,
    dlon = (b.lon - a.lon) * rad;
  const x =
    Math.sin(dlat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dlon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}
export function relevantReports(
  job: Pick<Job, "siteId" | "vehicle">,
  reports: Report[],
  now = Date.now(),
) {
  return reports.filter(
    (r) =>
      !r.deleted &&
      r.siteId === job.siteId &&
      Date.parse(r.observedAt) <= now &&
      Date.parse(r.expiresAt) > now &&
      (r.vehicle === "All vehicles" || r.vehicle === job.vehicle),
  );
}
export function evidenceFor(
  job: Pick<Job, "siteId" | "vehicle">,
  reports: Report[],
): Evidence[] {
  return relevantReports(job, reports).map(
    ({ id, title, severity, observedAt, expiresAt, vehicle, verified }) => ({
      reportId: id,
      title,
      severity,
      observedAt,
      expiresAt,
      vehicle,
      verified,
    }),
  );
}
export function nearestOrder<T extends { lat: number; lon: number }>(
  stops: T[],
): T[] {
  if (stops.length < 2) return [...stops];
  const todo = stops.slice(1),
    out = [stops[0]];
  while (todo.length) {
    let best = 0;
    todo.forEach((s, i) => {
      if (
        distance(out[out.length - 1], s) <
        distance(out[out.length - 1], todo[best])
      )
        best = i;
    });
    out.push(todo.splice(best, 1)[0]);
  }
  return out;
}
export function canEdit(identity: Identity, entity: Entity) {
  if (identity.role === "owner" || identity.role === "dispatcher") return true;
  if (identity.role === "viewer") return false;
  return entity.kind === "report"
    ? entity.authorId === identity.id
    : entity.kind === "photo"
      ? true
      : entity.kind === "job" && entity.assigneeId === identity.id;
}
export function csv(rows: Record<string, unknown>[]) {
  if (!rows.length) return "";
  const keys = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    let s = String(v ?? "");
    if (/^[=+@-]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  };
  return [
    keys.map(esc).join(","),
    ...rows.map((r) => keys.map((k) => esc(r[k])).join(",")),
  ].join("\r\n");
}
export function exportFile(
  name: string,
  body: string,
  type = "application/json",
) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function relativeTime(iso: string) {
  const d = (Date.now() - Date.parse(iso)) / 60000;
  if (!Number.isFinite(d)) return "Unknown";
  if (d < 1) return "Just now";
  if (d < 60) return `${Math.floor(d)}m ago`;
  if (d < 1440) return `${Math.floor(d / 60)}h ago`;
  return `${Math.floor(d / 1440)}d ago`;
}
