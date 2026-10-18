import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  LayoutDashboard,
  ClipboardList,
  Map,
  Radio,
  Route,
  Users,
  Settings,
  Compass,
  Plus,
  ArrowUpRight,
  ArrowRight,
  Search,
  Bell,
  RefreshCw,
  Wifi,
  WifiOff,
  CheckCircle2,
  AlertTriangle,
  Clock3,
  MapPin,
  MoreHorizontal,
  ChevronRight,
  Truck,
  CloudSun,
  Download,
  Menu,
  X,
  ShieldCheck,
  KeyRound,
  LogOut,
  Check,
  Navigation,
  Flag,
  FileText,
  CircleHelp,
  Loader2,
} from "lucide-react";
import { useWorkspace } from "./useWorkspace";
import {
  type Entity,
  type Job,
  type Site,
  type Report,
  type Photo,
  type Weather,
  type Status,
  type Role,
  statusLabels,
  relevantReports,
  evidenceFor,
  canEdit,
  relativeTime,
  csv,
  exportFile,
  nearestOrder,
  distance,
} from "./domain";
import MapView from "./components/MapView";
import { JobForm, SiteForm, ReportForm } from "./components/Forms";
import { SignIn } from "./components/SignIn";
import { Modal, Field } from "./components/Modal";
import { call, getWeather } from "./api";
import * as storage from "./data";
const nav = [
  ["overview", "Overview", LayoutDashboard],
  ["jobs", "Assignments", ClipboardList],
  ["map", "Sites & map", Map],
  ["reports", "Field intelligence", Radio],
  ["trip", "Trip planner", Route],
  ["team", "Team", Users],
  ["settings", "Workspace settings", Settings],
] as const;
function Empty({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <Compass size={32} />
      <h3>{title}</h3>
      <p>{detail}</p>
      {action}
    </div>
  );
}
function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export default function App() {
  const w = useWorkspace(),
    [page, setPage] = useState("overview"),
    [menu, setMenu] = useState(false),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [modal, setModal] = useState<ReactNode>(null),
    [detail, setDetail] = useState<Entity | null>(null),
    [weather, setWeather] = useState<Weather | null>(null),
    [weatherBusy, setWeatherBusy] = useState(false),
    [weatherSite, setWeatherSite] = useState(""),
    [weatherError, setWeatherError] = useState(""),
    [tripIds, setTripIds] = useState<string[]>([]),
    [tripRoute, setTripRoute] = useState<number[][] | undefined>(),
    [tripInfo, setTripInfo] = useState(""),
    [routeBusy, setRouteBusy] = useState(false),
    [notice, setNotice] = useState("");
  useEffect(() => {
    setModal(null);
    setDetail(null);
    setWeather(null);
    setWeatherError("");
    setTripIds([]);
    setTripRoute(undefined);
    setTripInfo("");
    setNotice("");
    setPage("overview");
  }, [w.scope]);
  const sites = useMemo(
      () => w.rows.filter((x): x is Site => x.kind === "site"),
      [w.rows],
    ),
    jobs = useMemo(
      () => w.rows.filter((x): x is Job => x.kind === "job"),
      [w.rows],
    ),
    reports = useMemo(
      () =>
        w.rows
          .filter((x): x is Report => x.kind === "report")
          .sort((a, b) => b.observedAt.localeCompare(a.observedAt)),
      [w.rows],
    ),
    photos = w.rows.filter((x): x is Photo => x.kind === "photo");
  const active = jobs.filter(
      (j) => !["completed", "failed"].includes(j.status),
    ),
    done = jobs.filter((j) => j.status === "completed"),
    fresh = reports.filter((r) => Date.parse(r.expiresAt) > Date.now()),
    affected = active.filter((j) =>
      relevantReports(j, reports).some((r) => r.severity !== "info"),
    );
  const manage = ["owner", "dispatcher"].includes(w.identity.role),
    editor = w.identity.role !== "viewer";
  const findSite = (id: string) => sites.find((s) => s.id === id),
    findName = (id: string) =>
      w.members.find((m) => m.id === id)?.name || "Unassigned";
  const close = () => setModal(null);
  const jobForm = (job?: Job) =>
    !sites.length
      ? setModal(
          <Modal title="Add a destination first" onClose={close}>
            <p>
              Add a site with its location and access details before assigning a
              visit.
            </p>
            <footer>
              <button className="btn primary" onClick={() => siteForm()}>
                Add site
              </button>
            </footer>
          </Modal>,
        )
      : setModal(
          <JobForm
            job={job}
            sites={sites}
            members={w.members}
            reports={reports}
            onSave={w.save}
            onClose={close}
          />,
        );
  const siteForm = (site?: Site) =>
    setModal(
      <SiteForm
        site={site}
        geo={!!w.providers.geoapify}
        onSave={w.save}
        onClose={close}
      />,
    );
  const reportForm = (site?: string) =>
    !sites.length
      ? setModal(
          <Modal title="No sites are available yet" onClose={close}>
            <p>
              {manage
                ? "Add a site before recording access observations."
                : "Ask your dispatcher to add the destination you visited."}
            </p>
            <footer>
              {manage && (
                <button className="btn primary" onClick={() => siteForm()}>
                  Add site
                </button>
              )}
              <button className="btn" onClick={close}>
                Close
              </button>
            </footer>
          </Modal>,
        )
      : setModal(
          <ReportForm
            sites={sites}
            identity={w.identity}
            defaultSite={site}
            onSave={w.save}
            onClose={close}
          />,
        );
  const open = (e: Entity) => setDetail(e);
  useEffect(() => {
    if (detail) {
      const latest = w.rows.find((e) => e.id === detail.id);
      if (latest) setDetail(latest);
    }
  }, [w.rows]);
  function navigate(p: string) {
    setPage(p);
    setQuery("");
    setFilter("all");
    setMenu(false);
  }
  async function act(fn: () => Promise<unknown>) {
    try {
      await fn();
    } catch (e) {
      w.setMessage((e as Error).message);
    }
  }
  async function forecast(site: Site, provider = "met") {
    setWeatherBusy(true);
    setWeatherError("");
    setWeatherSite(site.id);
    try {
      const result = await getWeather(site.lat, site.lon, provider);
      setWeather(result);
      await storage.meta(`weather:${w.scope}:${site.id}`, result);
    } catch (e) {
      const cached = (await storage.meta(`weather:${w.scope}:${site.id}`)) as
        | Weather
        | undefined;
      if (cached) setWeather({ ...cached, cached: true });
      setWeatherError((e as Error).message);
    } finally {
      setWeatherBusy(false);
    }
  }
  const selectedJobs = tripIds
      .map((id) => jobs.find((j) => j.id === id))
      .filter((j): j is Job => !!j),
    tripSites = selectedJobs
      .map((j) => findSite(j.siteId))
      .filter((s): s is Site => !!s);
  const simpleDistance = tripSites
    .slice(1)
    .reduce((sum, s, i) => sum + distance(tripSites[i], s), 0);
  function reorder() {
    const ordered = nearestOrder(
      selectedJobs.map((j) => ({ ...j, ...findSite(j.siteId)!, jobId: j.id })),
    );
    setTripIds(ordered.map((s) => s.jobId));
    setTripRoute(undefined);
    setTripInfo(
      "Ordered by straight-line proximity, keeping the first stop fixed. Verify road access before departure.",
    );
  }
  async function roadRoute() {
    setRouteBusy(true);
    try {
      const r = await call("route", {
        stops: tripSites.map((s) => ({ lat: s.lat, lon: s.lon })),
      });
      setTripRoute(r.coordinates);
      setTripInfo(
        `Road estimate: ${(r.distance / 1000).toFixed(1)} km · ${Math.ceil(r.time / 60)} min. Traffic, field reports and load restrictions are not included.`,
      );
    } catch (e) {
      setTripInfo((e as Error).message);
    } finally {
      setRouteBusy(false);
    }
  }
  function tripBrief() {
    exportFile(
      "field-commander-trip.json",
      JSON.stringify(
        {
          createdAt: new Date().toISOString(),
          workspace: w.identity.workspace,
          method: tripRoute
            ? "Geoapify road route"
            : "Straight-line stop sequence",
          jobs: selectedJobs.map((j) => ({
            ...j,
            site: findSite(j.siteId),
            currentEvidence: evidenceFor(j, reports),
          })),
        },
        null,
        2,
      ),
    );
  }
  function jobRow(j: Job) {
    const risks = relevantReports(j, reports).filter(
      (r) => r.severity !== "info",
    );
    return (
      <tr
        key={j.id}
        onClick={() => open(j)}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter") open(j);
        }}
      >
        <td>
          <div className="job-title">
            <span
              className={`job-glyph ${j.status === "completed" ? "complete" : ""}`}
            >
              {j.status === "completed" ? (
                <Check size={16} />
              ) : (
                <ClipboardList size={16} />
              )}
            </span>
            <div>
              <strong>{j.title}</strong>
              <small>{findSite(j.siteId)?.name || "Unknown site"}</small>
            </div>
          </div>
        </td>
        <td>
          <Badge tone={j.status}>{statusLabels[j.status]}</Badge>
        </td>
        <td>
          <span className="person">
            <span className="avatar small">
              {findName(j.assigneeId)
                .split(" ")
                .map((s) => s[0])
                .slice(0, 2)
                .join("")}
            </span>
            {findName(j.assigneeId).split(" ")[0]}
          </span>
        </td>
        <td>
          <span
            className={
              Date.parse(j.dueAt) < Date.now() && active.includes(j)
                ? "overdue"
                : ""
            }
          >
            {new Date(j.dueAt).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </td>
        <td>
          {risks.length ? (
            <Badge
              tone={
                risks.some((r) => r.severity === "blocked")
                  ? "blocked"
                  : "caution"
              }
            >
              <AlertTriangle size={12} />
              {risks.length} access {risks.length === 1 ? "report" : "reports"}
            </Badge>
          ) : (
            <span className="muted">—</span>
          )}
        </td>
        <td>
          <ChevronRight size={16} />
        </td>
      </tr>
    );
  }
  function reportCard(r: Report) {
    const expired = Date.parse(r.expiresAt) <= Date.now();
    return (
      <button className="report-card" key={r.id} onClick={() => open(r)}>
        <span className={`report-icon ${r.severity}`}>
          {r.severity === "info" ? (
            <MapPin size={18} />
          ) : (
            <AlertTriangle size={18} />
          )}
        </span>
        <div>
          <div className="report-top">
            <Badge tone={expired ? "neutral" : r.severity}>
              {expired
                ? "Needs fresh observation"
                : r.severity === "blocked"
                  ? "Reported blocked"
                  : r.severity === "caution"
                    ? "Caution"
                    : "Access update"}
            </Badge>
            <span>{relativeTime(r.observedAt)}</span>
          </div>
          <h3>{r.title}</h3>
          <p>
            {findSite(r.siteId)?.name} <span>·</span> {r.vehicle}
          </p>
          <div className="report-foot">
            <span>
              {r.verified ? (
                <>
                  <ShieldCheck size={13} /> Reviewed
                </>
              ) : (
                <>
                  <Clock3 size={13} /> Unreviewed
                </>
              )}
            </span>
            <ChevronRight size={16} />
          </div>
        </div>
      </button>
    );
  }
  const searchLower = query.toLowerCase();
  const filteredJobs = jobs.filter(
    (j) =>
      (filter === "all" ||
        (filter === "attention" && affected.includes(j)) ||
        filter === j.status) &&
      (j.title + " " + findSite(j.siteId)?.name + " " + findName(j.assigneeId))
        .toLowerCase()
        .includes(searchLower),
  );
  if (!w.authenticated)
    return <SignIn onLogin={w.connect} message={w.message} online={w.online} />;
  return (
    <div className="app-shell">
      <aside className={`sidebar ${menu ? "open" : ""}`}>
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate("overview");
          }}
          className="brand"
        >
          <span className="brand-icon">
            <Compass size={25} />
          </span>
          <span>
            Field<span>Commander</span>
          </span>
        </a>
        <div className="workspace-label">
          <span className="workspace-dot" />
          <div>
            <strong>{w.identity.workspace}</strong>
            <small>{"Team operations"}</small>
          </div>
          <ChevronRight size={14} />
        </div>
        <div className="nav-caption">WORKSPACE</div>
        <nav>
          {nav.slice(0, 6).map(([id, label, Icon]) => (
            <button
              key={id}
              className={page === id ? "active" : ""}
              onClick={() => navigate(id)}
            >
              <Icon size={19} />
              {label}
              {id === "reports" &&
                fresh.some((r) => r.severity === "blocked") && (
                  <span className="nav-count">
                    {fresh.filter((r) => r.severity === "blocked").length}
                  </span>
                )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="field-note">
            <Radio size={21} />
            <strong>
              Good decisions start
              <br />
              with ground truth.
            </strong>
            <p>Keep your team’s latest observations close.</p>
            <button onClick={() => navigate("reports")}>
              View field intelligence <ArrowUpRight size={14} />
            </button>
          </div>
          <nav>
            <button
              className={page === "settings" ? "active" : ""}
              onClick={() => navigate("settings")}
            >
              <Settings size={19} />
              Workspace settings
            </button>
            <button
              onClick={() =>
                setModal(
                  <Modal title="About Field Commander" onClose={close}>
                    <div className="about">
                      <img
                        className="operations-illustration"
                        src="/operations-landscape.webp"
                        width="1536"
                        height="1024"
                        alt="Illustration of civilian field teams connecting a clinic, warehouse and service site"
                      />
                      <p>
                        Plan a visit, check recent access evidence, capture work
                        offline and learn from the outcome. Field Commander
                        supports civilian logistics, maintenance and community
                        service teams.
                      </p>
                      <p>
                        Maps and forecasts support planning. Verify access
                        locally. Offline saves stay on this device until the
                        server issues a receipt.
                      </p>
                      <small>
                        Map data © OpenStreetMap contributors, map service
                        OpenFreeMap. Weather: MET Norway / optional WeatherAPI.
                        Location services: optional Geoapify.
                      </small>
                    </div>
                  </Modal>,
                )
              }
            >
              <CircleHelp size={19} />
              Help & about
            </button>
          </nav>
          <div className="profile">
            <span className="avatar">
              {w.identity.name
                .split(" ")
                .map((s) => s[0])
                .slice(0, 2)
                .join("")}
            </span>
            <div>
              <strong>{w.identity.name}</strong>
              <small>{w.identity.role}</small>
            </div>
            <button
              className="icon-btn"
              aria-label="Account settings"
              onClick={() => navigate("settings")}
            >
              <MoreHorizontal size={18} />
            </button>
          </div>
        </div>
      </aside>
      {menu && (
        <button
          className="sidebar-backdrop"
          aria-label="Close navigation"
          onClick={() => setMenu(false)}
        />
      )}
      <div className="main-shell">
        <header className="topbar">
          <button
            className="icon-btn mobile-menu"
            aria-label="Open navigation"
            onClick={() => setMenu(true)}
          >
            <Menu size={21} />
          </button>
          <span className="breadcrumb">
            Workspace <ChevronRight size={13} />
            <strong>{nav.find((n) => n[0] === page)?.[1]}</strong>
          </span>
          <div className="top-actions">
            <span className={`connection ${w.online ? "" : "offline"}`}>
              {w.online ? <Wifi size={14} /> : <WifiOff size={14} />}{" "}
              {w.online ? "Connected" : "Offline"}
            </span>
            <button
              className="icon-btn"
              aria-label="Open sync and notifications"
              onClick={() => navigate("settings")}
            >
              <Bell size={19} />
              {w.pending.length > 0 && <i />}
            </button>
            <span className="avatar small">
              {w.identity.name
                .split(" ")
                .map((s) => s[0])
                .slice(0, 2)
                .join("")}
            </span>
          </div>
        </header>

        {!w.online && (
          <div className="offline-banner">
            <WifiOff size={16} />
            Offline. Assignments and observations save on this device. Basemaps
            and live services need a connection.
          </div>
        )}
        {(w.message || notice) && (
          <div className="notification" role="status">
            <span>{notice || w.message}</span>
            <button
              className="icon-btn"
              aria-label="Dismiss notification"
              onClick={() => {
                w.setMessage("");
                setNotice("");
              }}
            >
              <X size={16} />
            </button>
          </div>
        )}
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {page === "overview"
                  ? "YOUR OPERATIONS, IN VIEW"
                  : "FIELD COMMANDER"}
              </div>
              <h1>
                {page === "overview"
                  ? `Good ${new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"}, ${w.identity.name.split(" ")[0]}.`
                  : nav.find((n) => n[0] === page)?.[1]}
              </h1>
              <p>
                {
                  (
                    {
                      overview:
                        "A clear picture of your team, your sites, and what needs attention.",
                      jobs: "Give every visit an owner, a plan, and a recorded outcome.",
                      map: "Save the right entrance and the practical details that maps miss.",
                      reports:
                        "Recent observations, with context for the next decision.",
                      trip: "Build a practical stop sequence and review access before leaving.",
                      team: "Give each person the access they need.",
                      settings:
                        "Your connection, device storage, integrations and data.",
                    } as Record<string, string>
                  )[page]
                }
              </p>
            </div>
            <div className="heading-actions">
              {page === "overview" && (
                <span className="date">
                  <Clock3 size={15} />
                  {new Date().toLocaleDateString([], {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </span>
              )}
              {manage && ["overview", "jobs"].includes(page) && (
                <button className="btn primary" onClick={() => jobForm()}>
                  <Plus size={17} />
                  New assignment
                </button>
              )}
              {manage && page === "map" && (
                <button className="btn primary" onClick={() => siteForm()}>
                  <Plus size={17} />
                  Add site
                </button>
              )}
              {editor && page === "reports" && (
                <button className="btn primary" onClick={() => reportForm()}>
                  <Plus size={17} />
                  Share observation
                </button>
              )}
            </div>
          </div>
          {!w.loaded ? (
            <div className="empty">
              <Loader2 className="spin" />
              Loading saved workspace…
            </div>
          ) : (
            <>
              {page === "overview" && (
                <>
                  <div className="stats">
                    <div className="stat">
                      <span>
                        Open assignments <ClipboardList size={18} />
                      </span>
                      <strong>
                        {active.length}
                        <small>to deliver</small>
                      </strong>
                      <p>
                        {jobs.filter((j) => j.status === "in-progress").length}{" "}
                        currently in progress
                      </p>
                    </div>
                    <div className="stat">
                      <span>
                        Completed <CheckCircle2 size={18} />
                      </span>
                      <strong>
                        {done.length}
                        <small>assignments</small>
                      </strong>
                      <p>Recorded outcomes, visible to the team</p>
                    </div>
                    <div className="stat warning">
                      <span>
                        Access attention <AlertTriangle size={18} />
                      </span>
                      <strong>
                        {affected.length}
                        <small>assignments</small>
                      </strong>
                      <p>Recent reports to review before departure</p>
                    </div>
                    <div className="stat">
                      <span>
                        Known sites <MapPin size={18} />
                      </span>
                      <strong>
                        {sites.length}
                        <small>destinations</small>
                      </strong>
                      <p>Entrances, notes and local knowledge</p>
                    </div>
                  </div>
                  <div className="overview-grid">
                    <section className="panel map-panel">
                      <div className="panel-head">
                        <div>
                          <h2>Operations on the ground</h2>
                          <p>Your destinations and recent access signals</p>
                        </div>
                        <button
                          className="text-btn"
                          onClick={() => navigate("map")}
                        >
                          Open map <ArrowUpRight size={15} />
                        </button>
                      </div>
                      <MapView sites={sites} reports={fresh} onSelect={open} />
                      <div className="map-legend">
                        <span>
                          <i className="legend-dot" />
                          Saved site
                        </span>
                        <span>
                          <i className="legend-dot red" />
                          Recent blocked-access report
                        </span>
                        <span className="muted">Verify conditions locally</span>
                      </div>
                    </section>
                    <section className="panel intelligence">
                      <div className="panel-head">
                        <div>
                          <h2>Field intelligence</h2>
                          <p>What your team is seeing</p>
                        </div>
                        <span className="live-label">
                          <i />
                          RECENT
                        </span>
                      </div>
                      {fresh.length ? (
                        fresh.slice(0, 3).map(reportCard)
                      ) : (
                        <Empty
                          title="No fresh reports"
                          detail="Ask the team to share observations from their next visit."
                        />
                      )}
                      <button
                        className="panel-link"
                        onClick={() => navigate("reports")}
                      >
                        View all observations <ArrowRight size={16} />
                      </button>
                    </section>
                  </div>
                  <section className="panel assignment-panel">
                    <div className="panel-head">
                      <div>
                        <h2>Assignments to keep moving</h2>
                        <p>
                          Upcoming work and the signals that could affect it
                        </p>
                      </div>
                      <button
                        className="text-btn"
                        onClick={() => navigate("jobs")}
                      >
                        View all assignments <ArrowUpRight size={15} />
                      </button>
                    </div>
                    {active.length ? (
                      <div className="table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>ASSIGNMENT / SITE</th>
                              <th>STATUS</th>
                              <th>ASSIGNEE</th>
                              <th>DUE</th>
                              <th>ACCESS</th>
                              <th />
                            </tr>
                          </thead>
                          <tbody>{active.slice(0, 5).map(jobRow)}</tbody>
                        </table>
                      </div>
                    ) : (
                      <Empty
                        title="Ready for your first assignment"
                        detail="Add a site and give the team a clear next step."
                      />
                    )}
                  </section>
                  <div className="bottom-cards">
                    <div className="tip-card">
                      <span className="tip-icon">
                        <Route size={24} />
                      </span>
                      <div>
                        <h3>Every good visit starts with a better plan.</h3>
                        <p>
                          Put your stops in order. Check the latest reports.
                          Bring the right context.
                        </p>
                      </div>
                      <button className="btn" onClick={() => navigate("trip")}>
                        Plan a trip <ArrowRight size={15} />
                      </button>
                    </div>
                    <div className="sync-card">
                      <ShieldCheck size={21} />
                      <div>
                        <strong>
                          {w.pending.length
                            ? `${w.pending.length} changes awaiting receipts`
                            : "Your device queue is clear"}
                        </strong>
                        <p>
                          {w.lastSync
                            ? `Last sync ${relativeTime(w.lastSync)}`
                            : "Sync when connected to refresh shared data."}
                        </p>
                      </div>
                      <button
                        className="icon-btn"
                        aria-label="Sync workspace"
                        disabled={w.busy}
                        onClick={() => void w.sync()}
                      >
                        <RefreshCw size={17} className={w.busy ? "spin" : ""} />
                      </button>
                    </div>
                  </div>
                </>
              )}
              {page === "jobs" && (
                <section className="panel">
                  <div className="list-toolbar">
                    <div className="tabs">
                      {[
                        ["all", "All assignments"],
                        ["attention", "Needs attention"],
                        ["in-progress", "In progress"],
                        ["completed", "Completed"],
                      ].map(([id, label]) => (
                        <button
                          key={id}
                          className={filter === id ? "active" : ""}
                          onClick={() => setFilter(id)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <label className="search">
                      <Search size={17} />
                      <input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search assignments"
                        aria-label="Search assignments"
                      />
                    </label>
                    <button
                      className="icon-btn"
                      title="Export assignments as CSV"
                      onClick={() =>
                        exportFile(
                          "assignments.csv",
                          csv(
                            filteredJobs.map((j) => ({
                              title: j.title,
                              site: findSite(j.siteId)?.name,
                              assignee: findName(j.assigneeId),
                              status: statusLabels[j.status],
                              dueAt: j.dueAt,
                              outcome: j.outcome,
                            })),
                          ),
                          "text/csv",
                        )
                      }
                    >
                      <Download size={18} />
                    </button>
                  </div>
                  {filteredJobs.length ? (
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>ASSIGNMENT / SITE</th>
                            <th>STATUS</th>
                            <th>ASSIGNEE</th>
                            <th>DUE</th>
                            <th>ACCESS</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>{filteredJobs.map(jobRow)}</tbody>
                      </table>
                    </div>
                  ) : (
                    <Empty
                      title="No assignments here yet"
                      detail="Try another filter or create your first assignment."
                    />
                  )}
                </section>
              )}
              {page === "map" && (
                <div className="sites-grid">
                  <section className="panel">
                    <div className="panel-head">
                      <h2>
                        Saved destinations{" "}
                        <span className="muted">({sites.length})</span>
                      </h2>
                    </div>
                    <label className="search site-search">
                      <Search size={17} />
                      <input
                        aria-label="Search sites"
                        placeholder="Search sites"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    </label>
                    <div className="sites-list">
                      {sites
                        .filter((s) =>
                          (s.name + " " + s.address)
                            .toLowerCase()
                            .includes(searchLower),
                        )
                        .map((s, i) => (
                          <button key={s.id} onClick={() => open(s)}>
                            <span className="site-number">{i + 1}</span>
                            <div>
                              <strong>{s.name}</strong>
                              <small>
                                {s.address ||
                                  `${s.lat.toFixed(4)}, ${s.lon.toFixed(4)}`}
                              </small>
                              <p>
                                {s.entrance ||
                                  "Add entrance information after a visit."}
                              </p>
                            </div>
                            <ChevronRight size={16} />
                          </button>
                        ))}
                    </div>
                    {!sites.length && (
                      <Empty
                        title="Add your destinations"
                        detail="Save coordinates and practical site access details."
                      />
                    )}
                  </section>
                  <section className="panel">
                    <MapView
                      sites={sites}
                      reports={fresh}
                      onSelect={open}
                      large
                    />
                    <div className="map-legend">
                      <span>
                        <i className="legend-dot" />
                        Saved site
                      </span>
                      <span>
                        <i className="legend-dot red" />
                        Reported blocked
                      </span>
                    </div>
                  </section>
                </div>
              )}
              {page === "reports" && (
                <>
                  <div className="list-toolbar">
                    <div className="tabs">
                      {[
                        ["all", "All observations"],
                        ["fresh", "Fresh"],
                        ["blocked", "Reported blocked"],
                        ["expired", "Needs refresh"],
                      ].map(([id, label]) => (
                        <button
                          key={id}
                          className={filter === id ? "active" : ""}
                          onClick={() => setFilter(id)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <label className="search">
                      <Search size={17} />
                      <input
                        aria-label="Search observations"
                        placeholder="Search observations"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    </label>
                  </div>
                  <div className="report-grid">
                    {reports
                      .filter(
                        (r) =>
                          (
                            r.title +
                            " " +
                            r.notes +
                            " " +
                            findSite(r.siteId)?.name
                          )
                            .toLowerCase()
                            .includes(searchLower) &&
                          (filter === "all" ||
                            (filter === "fresh" &&
                              Date.parse(r.expiresAt) > Date.now()) ||
                            (filter === "expired" &&
                              Date.parse(r.expiresAt) <= Date.now()) ||
                            (filter === "blocked" && r.severity === "blocked")),
                      )
                      .map(reportCard)}
                  </div>
                  {!reports.length && (
                    <Empty
                      title="Build your team’s field knowledge"
                      detail="Share time-stamped observations about roads, crossings and entrances."
                    />
                  )}
                  <p className="fineprint">
                    “Reviewed” means a dispatcher reviewed the report. It does
                    not independently confirm current access. Expired
                    observations remain in history.
                  </p>
                </>
              )}
              {page === "trip" && (
                <div className="trip-grid">
                  <section className="panel">
                    <div className="panel-head">
                      <div>
                        <h2>Select your stops</h2>
                        <p>Choose open assignments in departure order</p>
                      </div>
                    </div>
                    <div className="trip-options">
                      {active.map((j) => (
                        <label key={j.id}>
                          <input
                            type="checkbox"
                            checked={tripIds.includes(j.id)}
                            onChange={(e) => {
                              setTripIds(
                                e.target.checked
                                  ? [...tripIds, j.id]
                                  : tripIds.filter((id) => id !== j.id),
                              );
                              setTripRoute(undefined);
                            }}
                          />
                          <div>
                            <strong>{j.title}</strong>
                            <small>
                              {findSite(j.siteId)?.name} · {j.vehicle}
                            </small>
                            {relevantReports(j, reports).some(
                              (r) => r.severity !== "info",
                            ) && (
                              <Badge tone="caution">
                                Review access evidence
                              </Badge>
                            )}
                          </div>
                        </label>
                      ))}
                    </div>
                    <div className="trip-controls">
                      <button
                        className="btn"
                        disabled={tripSites.length < 2}
                        onClick={reorder}
                      >
                        <Route size={16} />
                        Order by proximity
                      </button>
                      <button
                        className="btn primary"
                        disabled={
                          !w.providers.geoapify ||
                          tripSites.length < 2 ||
                          routeBusy ||
                          !w.online
                        }
                        onClick={() => void roadRoute()}
                      >
                        {routeBusy ? (
                          <Loader2 className="spin" size={16} />
                        ) : (
                          <Navigation size={16} />
                        )}
                        Estimate road route
                      </button>
                      {!w.providers.geoapify && (
                        <small>
                          Road routing is unavailable. Straight-line planning is
                          available now.
                        </small>
                      )}
                    </div>
                  </section>
                  <section className="panel">
                    <MapView
                      sites={tripSites}
                      reports={fresh}
                      route={tripRoute || tripSites.map((s) => [s.lon, s.lat])}
                      onSelect={open}
                    />
                    <div className="trip-summary">
                      <h2>
                        {tripSites.length} stops{" "}
                        <span className="muted">
                          · {simpleDistance.toFixed(1)} km straight-line
                        </span>
                      </h2>
                      <p>
                        {tripInfo ||
                          "The connecting lines show stop order, not a driveable route. Road restrictions and reported hazards require review."}
                      </p>
                      {tripRoute && (
                        <p className="fineprint">
                          Road estimate by{" "}
                          <a
                            href="https://www.geoapify.com/"
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Geoapify
                          </a>{" "}
                          · ©{" "}
                          <a
                            href="https://www.openstreetmap.org/copyright"
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            OpenStreetMap contributors
                          </a>
                        </p>
                      )}
                      {selectedJobs.map((j, i) => (
                        <div className="trip-stop" key={j.id}>
                          <span className="site-number">{i + 1}</span>
                          <div>
                            <strong>{j.title}</strong>
                            <p>{findSite(j.siteId)?.entrance}</p>
                            {relevantReports(j, reports)
                              .filter((r) => r.severity !== "info")
                              .map((r) => (
                                <button
                                  key={r.id}
                                  className="text-btn caution-text"
                                  onClick={() => open(r)}
                                >
                                  <AlertTriangle size={14} />
                                  {r.title}
                                </button>
                              ))}
                          </div>
                        </div>
                      ))}
                      <button
                        className="btn"
                        disabled={!selectedJobs.length}
                        onClick={tripBrief}
                      >
                        <Download size={16} />
                        Export trip briefing
                      </button>
                    </div>
                  </section>
                </div>
              )}
              {page === "team" && (
                <section className="panel">
                  <div className="panel-head">
                    <div>
                      <h2>Workspace members</h2>
                      <p>Private access keys with server-enforced roles</p>
                    </div>
                    {w.identity.role === "owner" && (
                      <button
                        className="btn primary"
                        onClick={() =>
                          setModal(
                            <Invite
                              onClose={close}
                              onCreated={(m) => w.setMembers([...w.members, m])}
                            />,
                          )
                        }
                      >
                        <Plus size={16} />
                        Add member
                      </button>
                    )}
                  </div>
                  <div className="member-list">
                    {w.members.map((m) => (
                      <div className="member" key={m.id}>
                        <span className="avatar">
                          {m.name
                            .split(" ")
                            .map((s) => s[0])
                            .slice(0, 2)
                            .join("")}
                        </span>
                        <div>
                          <strong>
                            {m.name}
                            {m.id === w.identity.id ? " (you)" : ""}
                          </strong>
                          <small>{m.role}</small>
                        </div>
                        <Badge tone={m.active ? "info" : "neutral"}>
                          {m.active ? "Active" : "Revoked"}
                        </Badge>
                        {w.identity.role === "owner" &&
                          m.id !== w.identity.id &&
                          m.active && (
                            <button
                              className="text-btn danger"
                              onClick={() =>
                                setModal(
                                  <Modal
                                    title={`Revoke ${m.name}’s access?`}
                                    onClose={close}
                                  >
                                    <p>
                                      This stops new server requests. A device
                                      already offline may still contain
                                      previously downloaded data.
                                    </p>
                                    <footer>
                                      <button className="btn" onClick={close}>
                                        Cancel
                                      </button>
                                      <button
                                        className="btn danger"
                                        onClick={() =>
                                          void act(async () => {
                                            await call("revoke", { id: m.id });
                                            w.setMembers(
                                              w.members.map((x) =>
                                                x.id === m.id
                                                  ? { ...x, active: false }
                                                  : x,
                                              ),
                                            );
                                            close();
                                          })
                                        }
                                      >
                                        Revoke access
                                      </button>
                                    </footer>
                                  </Modal>,
                                )
                              }
                            >
                              Revoke
                            </button>
                          )}
                      </div>
                    ))}
                  </div>
                  <div className="info-box">
                    <ShieldCheck size={20} />
                    <p>
                      Owners manage members. Dispatchers plan and review. Field
                      members update assigned work and their observations.
                      Viewers read shared operational records. Each person needs
                      a separate key.
                    </p>
                  </div>
                </section>
              )}
              {page === "settings" && (
                <div className="settings-grid">
                  <section className="panel settings-panel">
                    <h2>
                      <KeyRound size={20} />
                      Workspace connection
                    </h2>
                    <p>
                      {`Signed in as ${w.identity.name} (${w.identity.role}).`}
                    </p>
                    <div className="setting-actions">
                      {
                        <button
                          className="btn"
                          onClick={() =>
                            setModal(
                              <Modal
                                title="Disconnect this session?"
                                onClose={close}
                              >
                                <p>
                                  {w.pending.length
                                    ? `${w.pending.length} operations still need server receipts. Export a backup before disconnecting. `
                                    : ""}
                                  Your device cache is retained. Use Clear
                                  device data to remove it separately.
                                </p>
                                <footer>
                                  <button className="btn" onClick={w.backup}>
                                    <Download size={16} />
                                    Export backup
                                  </button>
                                  <button
                                    className="btn"
                                    onClick={() =>
                                      void act(async () => {
                                        await w.disconnect();
                                        close();
                                      })
                                    }
                                  >
                                    <LogOut size={16} />
                                    Disconnect
                                  </button>
                                </footer>
                              </Modal>,
                            )
                          }
                        >
                          <LogOut size={16} />
                          Disconnect
                        </button>
                      }
                      <button
                        className="btn"
                        disabled={w.busy || !w.online}
                        onClick={() => void w.sync()}
                      >
                        <RefreshCw size={16} className={w.busy ? "spin" : ""} />
                        Sync now
                      </button>
                    </div>
                    <p className="fineprint">
                      Access credentials stay in browser session storage.
                      Offline caches remain on this device across sessions; use
                      a trusted device.
                    </p>
                    <h3>
                      Device outbox <Badge>{w.pending.length}</Badge>
                    </h3>
                    {!w.pending.length ? (
                      <p className="muted">
                        No changes waiting for server acknowledgment.
                      </p>
                    ) : (
                      w.pending.map((op) => (
                        <div className="outbox-item" key={op.id}>
                          <strong>
                            {"title" in op.entity
                              ? op.entity.title
                              : "name" in op.entity
                                ? op.entity.name
                                : "Observation photo"}
                          </strong>
                          <Badge
                            tone={
                              op.status === "conflict"
                                ? "caution"
                                : op.status === "error"
                                  ? "blocked"
                                  : "neutral"
                            }
                          >
                            {op.status}
                          </Badge>
                          <p>
                            {op.message ||
                              "Saved locally; waiting for server receipt."}
                          </p>
                          {op.status === "conflict" && !op.server && (
                            <p className="fineprint">
                              Export a device backup before reconnecting. The
                              workspace owner must reconcile pending work after
                              a database generation change.
                            </p>
                          )}
                          {op.status === "conflict" && op.server && (
                            <>
                              <button
                                className="btn"
                                onClick={() =>
                                  setModal(
                                    <Modal
                                      title="Review conflicting changes"
                                      onClose={close}
                                      wide
                                    >
                                      <div className="form-grid">
                                        <div>
                                          <h3>Your device version</h3>
                                          <pre>
                                            {describeRecord(
                                              w.rows.find(
                                                (row) =>
                                                  row.id === op.entity.id,
                                              ) || op.entity,
                                            )}
                                          </pre>
                                        </div>
                                        <div>
                                          <h3>Shared server version</h3>
                                          <pre>
                                            {op.server
                                              ? describeRecord(op.server)
                                              : "No shared record is available. The workspace may have been restored."}
                                          </pre>
                                        </div>
                                      </div>
                                      <p>
                                        Keeping your version submits a new
                                        revision after the current shared
                                        version. This replaces its fields.
                                      </p>
                                      <footer>
                                        <button
                                          className="btn"
                                          onClick={() =>
                                            void act(async () => {
                                              await w.resolve(op, false);
                                              close();
                                            })
                                          }
                                        >
                                          Use shared version
                                        </button>
                                        <button
                                          className="btn primary"
                                          onClick={() =>
                                            void act(async () => {
                                              await w.resolve(op, true);
                                              close();
                                            })
                                          }
                                        >
                                          Submit my version
                                        </button>
                                      </footer>
                                    </Modal>,
                                  )
                                }
                              >
                                Review conflict
                              </button>
                            </>
                          )}
                        </div>
                      ))
                    )}
                  </section>
                  <div>
                    <section className="panel settings-panel">
                      <h2>
                        <CloudSun size={20} />
                        Connected services
                      </h2>
                      <div className="integration">
                        <span>
                          <strong>OpenFreeMap + MapLibre</strong>
                          <small>
                            Interactive maps · no signup · attribution included
                          </small>
                        </span>
                        <Badge tone="info">Available</Badge>
                      </div>
                      <div className="integration">
                        <span>
                          <strong>MET Norway</strong>
                          <small>
                            Forecasts · no signup · cached server-side
                          </small>
                        </span>
                        <Badge>Available</Badge>
                      </div>
                      <div className="integration">
                        <span>
                          <strong>Geoapify</strong>
                          <small>Address search and road route estimates</small>
                        </span>
                        <Badge tone={w.providers.geoapify ? "info" : "neutral"}>
                          {w.providers.geoapify ? "Configured" : "Not enabled"}
                        </Badge>
                      </div>
                      <div className="integration">
                        <span>
                          <strong>WeatherAPI</strong>
                          <small>Alternative weather forecasts</small>
                        </span>
                        <Badge
                          tone={w.providers.weatherapi ? "info" : "neutral"}
                        >
                          {w.providers.weatherapi
                            ? "Configured"
                            : "Not enabled"}
                        </Badge>
                      </div>
                      <p className="fineprint">
                        Your workspace owner manages optional services. Route
                        estimates do not include field observations or confirm
                        vehicle access.
                      </p>
                    </section>
                    <section className="panel settings-panel">
                      <h2>
                        <Download size={20} />
                        Data & offline readiness
                      </h2>
                      <p>
                        Saved assignments, sites and reports work offline after
                        this app has loaded. Basemaps are online; downloaded
                        offline maps are not included.
                      </p>
                      <div className="setting-actions">
                        <button className="btn" onClick={w.backup}>
                          <Download size={16} />
                          Export device backup
                        </button>
                        <button
                          className="btn"
                          onClick={() =>
                            void act(async () => {
                              const persisted =
                                await navigator.storage?.persist();
                              const estimate =
                                await navigator.storage?.estimate();
                              setNotice(
                                `${persisted ? "Persistent storage granted." : "Browser may evict local data; keep backups."} Device storage used: ${((estimate?.usage || 0) / 1048576).toFixed(1)} MB.`,
                              );
                            })
                          }
                        >
                          <ShieldCheck size={16} />
                          Protect offline storage
                        </button>
                      </div>
                      <button
                        className="text-btn danger"
                        onClick={() =>
                          setModal(
                            <Modal
                              title="Clear this workspace’s device data?"
                              onClose={close}
                            >
                              <p>
                                Removes this workspace’s saved records and{" "}
                                {w.pending.length} queued operations from this
                                device. Shared server data remains available
                                when you reconnect. Export first.
                              </p>
                              <footer>
                                <button className="btn" onClick={w.backup}>
                                  Export backup
                                </button>
                                <button
                                  className="btn danger"
                                  disabled={w.busy}
                                  onClick={() =>
                                    void act(async () => {
                                      await storage.clearScope(w.scope);
                                      await w.refresh();
                                      close();
                                    })
                                  }
                                >
                                  Clear device data
                                </button>
                              </footer>
                            </Modal>,
                          )
                        }
                      >
                        Clear device data
                      </button>
                    </section>
                  </div>
                </div>
              )}
            </>
          )}
          <footer className="app-footer">
            <span>
              <Compass size={13} />
              Field Commander <span>·</span> Stay informed. Keep moving.
            </span>
            <span>{`${w.pending.length} pending · ${w.identity.role}`}</span>
          </footer>
        </main>
      </div>
      {modal}
      {detail && (
        <Modal
          title={
            detail.kind === "site"
              ? detail.name
              : detail.kind === "photo"
                ? "Observation photo"
                : detail.title
          }
          onClose={() => {
            setDetail(null);
            setWeather(null);
            setWeatherError("");
          }}
          wide
        >
          <div className="detail-content">
            {detail.pending && (
              <div className="info-box">
                <Clock3 size={18} />
                Saved on this device; awaiting a server receipt.
              </div>
            )}
            {detail.kind === "job" && (
              <>
                <div className="detail-meta">
                  <Badge tone={detail.status}>
                    {statusLabels[detail.status]}
                  </Badge>
                  <span>
                    <Truck size={15} />
                    {detail.vehicle}
                  </span>
                  <span>
                    <Users size={15} />
                    {findName(detail.assigneeId)}
                  </span>
                  <span>
                    <Clock3 size={15} />
                    {new Date(detail.dueAt).toLocaleString()}
                  </span>
                </div>
                <div className="detail-columns">
                  <div>
                    <h3>Destination & instructions</h3>
                    <button
                      className="site-link"
                      onClick={() => {
                        const s = findSite(detail.siteId);
                        if (s) open(s);
                      }}
                    >
                      <MapPin size={18} />
                      {findSite(detail.siteId)?.name}
                      <ArrowUpRight size={16} />
                    </button>
                    <p>{findSite(detail.siteId)?.entrance}</p>
                    <p className="preserve">
                      {detail.notes || "No additional instructions."}
                    </p>
                    <h3>Current access evidence</h3>
                    {relevantReports(detail, reports).length ? (
                      relevantReports(detail, reports).map(reportCard)
                    ) : (
                      <p className="muted">
                        No fresh vehicle-relevant reports. Absence of a report
                        does not confirm access.
                      </p>
                    )}
                    <h3>Evidence when planned</h3>
                    <p className="fineprint">
                      Snapshot saved{" "}
                      {new Date(detail.plannedAt).toLocaleString()}.
                    </p>
                    {detail.evidence.map((e) => (
                      <div className="snapshot" key={e.reportId}>
                        <Badge tone={e.severity}>{e.severity}</Badge>
                        {e.title}
                        <small>
                          Observed {new Date(e.observedAt).toLocaleString()} ·{" "}
                          {e.vehicle}
                        </small>
                      </div>
                    ))}
                  </div>
                  <div>
                    <h3>Record progress & outcome</h3>
                    {canEdit(w.identity, detail) ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          const f = new FormData(e.currentTarget);
                          void act(() =>
                            w.save({
                              ...detail,
                              status: String(f.get("status")) as Status,
                              outcome: String(f.get("outcome")).trim(),
                            }),
                          );
                        }}
                      >
                        <Field label="Work status">
                          <select
                            name="status"
                            defaultValue={detail.status}
                            key={detail.status}
                          >
                            {Object.entries(statusLabels).map(([s, l]) => (
                              <option key={s} value={s}>
                                {l}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Outcome / reason">
                          <textarea
                            name="outcome"
                            defaultValue={detail.outcome}
                            maxLength={3000}
                            placeholder="What happened? If work could not complete, what prevented it?"
                          />
                        </Field>
                        <button className="btn primary">Save outcome</button>
                      </form>
                    ) : (
                      <p>{detail.outcome || "No outcome recorded."}</p>
                    )}
                    <div className="setting-actions">
                      {manage && (
                        <button
                          className="btn"
                          onClick={() => {
                            setDetail(null);
                            jobForm(detail);
                          }}
                        >
                          Edit assignment
                        </button>
                      )}
                      {editor && (
                        <button
                          className="btn"
                          onClick={() => {
                            setDetail(null);
                            reportForm(detail.siteId);
                          }}
                        >
                          <Plus size={15} />
                          Add observation
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </>
            )}
            {detail.kind === "site" && (
              <>
                <div className="detail-columns">
                  <div>
                    <Badge tone="info">Saved site</Badge>
                    <p>{detail.address}</p>
                    <p className="muted">
                      {detail.lat.toFixed(5)}, {detail.lon.toFixed(5)}
                    </p>
                    <h3>Entrance & approach</h3>
                    <p className="preserve">
                      {detail.entrance || "No entrance notes yet."}
                    </p>
                    <h3>Site contact</h3>
                    <p>{detail.contact || "No contact saved."}</p>
                    <h3>Practical notes</h3>
                    <p className="preserve">
                      {detail.notes || "No additional notes."}
                    </p>
                    <div className="setting-actions">
                      {manage && (
                        <button
                          className="btn"
                          onClick={() => {
                            setDetail(null);
                            siteForm(detail);
                          }}
                        >
                          Edit site
                        </button>
                      )}
                      {editor && (
                        <button
                          className="btn"
                          onClick={() => {
                            setDetail(null);
                            reportForm(detail.id);
                          }}
                        >
                          Share observation
                        </button>
                      )}
                    </div>
                  </div>
                  <div>
                    <h3>Weather outlook</h3>
                    <p className="fineprint">
                      Forecasts support planning; they do not confirm road or
                      crossing conditions.
                    </p>
                    <div className="setting-actions">
                      <button
                        className="btn"
                        disabled={weatherBusy}
                        onClick={() => void forecast(detail)}
                      >
                        {weatherBusy ? (
                          <Loader2 className="spin" size={16} />
                        ) : (
                          <CloudSun size={16} />
                        )}
                        MET Norway
                      </button>
                      {w.providers.weatherapi && (
                        <button
                          className="btn"
                          disabled={weatherBusy}
                          onClick={() => void forecast(detail, "weatherapi")}
                        >
                          WeatherAPI
                        </button>
                      )}
                    </div>
                    {weatherError && (
                      <p className="form-error">{weatherError}</p>
                    )}
                    {weather && weatherSite === detail.id && (
                      <div className="weather">
                        <small>
                          <a
                            href={
                              weather.provider === "WeatherAPI"
                                ? "https://www.weatherapi.com/"
                                : "https://www.met.no/"
                            }
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {weather.provider}
                          </a>{" "}
                          · fetched {relativeTime(weather.fetchedAt)}
                          {weather.cached ? " · saved forecast" : ""}
                        </small>
                        {weather.points.slice(0, 8).map((p) => (
                          <div key={p.time}>
                            <span>
                              {new Date(p.time).toLocaleString([], {
                                weekday: "short",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                            <b>{Math.round(p.temperature)}°C</b>
                            <span>
                              {p.rain === null
                                ? "Rain unavailable"
                                : `${p.rain.toFixed(1)} mm`}
                            </span>
                            <span>{p.wind.toFixed(1)} m/s</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <h3>Site observations</h3>
                {reports.filter((r) => r.siteId === detail.id).map(reportCard)}
              </>
            )}
            {detail.kind === "report" && (
              <>
                <div className="detail-meta">
                  <Badge
                    tone={
                      Date.parse(detail.expiresAt) > Date.now()
                        ? detail.severity
                        : "neutral"
                    }
                  >
                    {Date.parse(detail.expiresAt) > Date.now()
                      ? detail.severity
                      : "Needs refresh"}
                  </Badge>
                  <span>{detail.vehicle}</span>
                  <span>{detail.category}</span>
                  <span>{detail.verified ? "Reviewed" : "Unreviewed"}</span>
                </div>
                <p>
                  <strong>{findSite(detail.siteId)?.name}</strong> · Observed{" "}
                  {new Date(detail.observedAt).toLocaleString()}
                </p>
                <p className="fineprint">
                  Review due {new Date(detail.expiresAt).toLocaleString()} ·
                  reported by {findName(detail.authorId)}
                </p>
                <p className="preserve">{detail.notes}</p>
                <div className="photo-gallery">
                  {photos
                    .filter((p) => p.reportId === detail.id)
                    .map((p) => (
                      <figure key={p.id}>
                        <img src={p.data} alt={p.caption} />
                        <figcaption>
                          {p.pending
                            ? "Photo awaiting server receipt"
                            : p.caption}
                        </figcaption>
                      </figure>
                    ))}
                </div>
                {manage && (
                  <button
                    className="btn"
                    onClick={() =>
                      void act(() =>
                        w.save({ ...detail, verified: !detail.verified }),
                      )
                    }
                  >
                    <ShieldCheck size={16} />
                    {detail.verified ? "Mark unreviewed" : "Mark as reviewed"}
                  </button>
                )}
                <p className="fineprint">
                  For changed conditions, add a fresh observation rather than
                  extending old evidence.
                </p>
              </>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
function Invite({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (m: any) => void;
}) {
  const [key, setKey] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <Modal title="Add a workspace member" onClose={onClose}>
      {key ? (
        <>
          <p>
            Share this private key directly with the intended person. It will
            not be shown again after closing.
          </p>
          <pre className="private-key">{key}</pre>
          <button
            className="btn"
            onClick={() =>
              navigator.clipboard
                .writeText(key)
                .catch(() =>
                  setError(
                    "Copy unavailable. Select and copy the key manually.",
                  ),
                )
            }
          >
            Copy private key
          </button>
          <footer>
            <button className="btn primary" onClick={onClose}>
              Done
            </button>
          </footer>
        </>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const f = new FormData(e.currentTarget);
            try {
              const r = await call("invite", {
                name: String(f.get("name")).trim(),
                role: String(f.get("role")) as Role,
              });
              setKey(r.key);
              onCreated(r.member);
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Member name">
            <input name="name" required maxLength={100} />
          </Field>
          <Field label="Role">
            <select name="role">
              <option value="field">
                Field — assigned work and observations
              </option>
              <option value="dispatcher">Dispatcher — plan and review</option>
              <option value="viewer">Viewer — read access</option>
            </select>
          </Field>
          <p className="fineprint">
            One person per key. Revoke a lost key and issue a replacement.
          </p>
          <footer>
            <button className="btn" type="button" onClick={onClose}>
              Cancel
            </button>
            <button className="btn primary" disabled={busy}>
              Create private key
            </button>
          </footer>
        </form>
      )}
      {error && <p className="form-error">{error}</p>}
    </Modal>
  );
}

function describeRecord(entity: Entity): string {
  const lines =
    entity.kind === "job"
      ? [
          entity.title,
          `Status: ${statusLabels[entity.status]}`,
          `Priority: ${entity.priority}`,
          `Due: ${new Date(entity.dueAt).toLocaleString()}`,
          `Notes: ${entity.notes || "None"}`,
          `Outcome: ${entity.outcome || "None"}`,
        ]
      : entity.kind === "site"
        ? [
            entity.name,
            `Address: ${entity.address || "None"}`,
            `Coordinates: ${entity.lat}, ${entity.lon}`,
            `Entrance: ${entity.entrance || "None"}`,
            `Contact: ${entity.contact || "None"}`,
            `Notes: ${entity.notes || "None"}`,
          ]
        : entity.kind === "report"
          ? [
              entity.title,
              `Severity: ${entity.severity}`,
              `Observed: ${new Date(entity.observedAt).toLocaleString()}`,
              `Expires: ${new Date(entity.expiresAt).toLocaleString()}`,
              `Reviewed: ${entity.verified ? "Yes" : "No"}`,
              `Details: ${entity.notes || "None"}`,
            ]
          : [entity.caption || "Photo evidence"];
  return lines.join("\n");
}
