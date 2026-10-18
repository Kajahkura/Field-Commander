import { useState, type FormEvent } from "react";
import {
  LocateFixed,
  Search,
  Loader2,
  ImagePlus,
  Check,
  KeyRound,
} from "lucide-react";
import { Modal, Field } from "./Modal";
import { call } from "../api";
import {
  evidenceFor,
  uid,
  type Entity,
  type Identity,
  type Job,
  type Member,
  type Report,
  type Site,
} from "../domain";
const localDate = (s: string) =>
  new Date(Date.parse(s) - new Date(s).getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
const vehicles = [
  "All vehicles",
  "Van",
  "Truck",
  "Pickup",
  "Motorcycle",
  "On foot",
];
export function JobForm({
  job,
  sites,
  members,
  reports,
  onSave,
  onClose,
}: {
  job?: Job;
  sites: Site[];
  members: Member[];
  reports: Report[];
  onSave: (e: Entity) => Promise<void>;
  onClose: () => void;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const f = new FormData(e.currentTarget);
    const j: Job = {
      ...job,
      id: job?.id || uid(),
      kind: "job" as const,
      revision: job?.revision || 0,
      updatedAt: new Date().toISOString(),
      title: String(f.get("title")).trim(),
      siteId: String(f.get("siteId")),
      assigneeId: String(f.get("assigneeId")),
      vehicle: String(f.get("vehicle")),
      status: job?.status || (f.get("assigneeId") ? "assigned" : "planned"),
      priority: String(f.get("priority")) as Job["priority"],
      dueAt: new Date(String(f.get("dueAt"))).toISOString(),
      notes: String(f.get("notes")).trim(),
      outcome: job?.outcome || "",
      plannedAt: new Date().toISOString(),
      evidence: [],
    };
    j.evidence = evidenceFor(j, reports);
    try {
      await onSave(j);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={job ? "Edit assignment" : "Create an assignment"}
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <p className="form-intro">
          Give the team a clear destination, owner and work window. Current
          access reports are saved with this plan.
        </p>
        <Field label="Assignment title">
          <input
            name="title"
            required
            maxLength={160}
            defaultValue={job?.title}
            placeholder="e.g. Deliver supplies to Northside clinic"
          />
        </Field>
        <div className="form-grid">
          <Field label="Destination">
            <select name="siteId" required defaultValue={job?.siteId}>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Assign to">
            <select name="assigneeId" defaultValue={job?.assigneeId || ""}>
              <option value="">Unassigned</option>
              {members
                .filter((m) => m.active && m.role !== "viewer")
                .map((m) => (
                  <option value={m.id} key={m.id}>
                    {m.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Due date and time">
            <input
              name="dueAt"
              type="datetime-local"
              required
              defaultValue={localDate(
                job?.dueAt || new Date(Date.now() + 3 * 3600000).toISOString(),
              )}
            />
          </Field>
          <Field label="Vehicle">
            <select name="vehicle" defaultValue={job?.vehicle || "Van"}>
              {vehicles
                .filter((x) => x !== "All vehicles")
                .map((v) => (
                  <option key={v}>{v}</option>
                ))}
            </select>
          </Field>
        </div>
        <Field label="Priority">
          <select name="priority" defaultValue={job?.priority || "normal"}>
            <option value="normal">Normal</option>
            <option value="high">High</option>
          </select>
        </Field>
        <Field label="Instructions">
          <textarea
            name="notes"
            maxLength={3000}
            defaultValue={job?.notes}
            placeholder="What should the team know before leaving?"
          />
        </Field>
        {!sites.length && (
          <p className="form-error">
            Add a site before creating an assignment.
          </p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <footer>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy || !sites.length}>
            {busy ? (
              <Loader2 className="spin" size={16} />
            ) : (
              <Check size={16} />
            )}{" "}
            Save assignment
          </button>
        </footer>
      </form>
    </Modal>
  );
}
export function SiteForm({
  site,
  onSave,
  onClose,
  geo,
}: {
  site?: Site;
  onSave: (e: Entity) => Promise<void>;
  onClose: () => void;
  geo: boolean;
}) {
  const [coords, setCoords] = useState({
      lat: site?.lat ?? 9.065,
      lon: site?.lon ?? 7.466,
    }),
    [query, setQuery] = useState(""),
    [results, setResults] = useState<any[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [address, setAddress] = useState(site?.address || "");
  async function search() {
    setBusy(true);
    setError("");
    try {
      const r = await call("geocode", { text: query });
      setResults(r.features || []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function locate() {
    setError("");
    navigator.geolocation?.getCurrentPosition(
      (p) => setCoords({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () =>
        setError("Location permission unavailable. Enter coordinates instead."),
      { timeout: 12000 },
    );
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      await onSave({
        id: site?.id || uid(),
        kind: "site",
        revision: site?.revision || 0,
        updatedAt: new Date().toISOString(),
        name: String(f.get("name")).trim(),
        ...coords,
        address,
        entrance: String(f.get("entrance")),
        contact: String(f.get("contact")),
        notes: String(f.get("notes")),
      });
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={site ? "Edit site" : "Add a field site"} onClose={onClose}>
      <form onSubmit={submit}>
        <Field label="Site name">
          <input
            name="name"
            required
            maxLength={160}
            defaultValue={site?.name}
            placeholder="Clinic, warehouse or service location"
          />
        </Field>
        <Field label="Address">
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            maxLength={500}
            placeholder="Street, community and region"
          />
        </Field>
        {geo && (
          <div className="address-search">
            <input
              aria-label="Search an address"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find coordinates with Geoapify"
            />
            <button
              type="button"
              className="btn"
              onClick={search}
              disabled={busy || query.trim().length < 3}
            >
              <Search size={16} />
            </button>
          </div>
        )}
        {results.map((r, i) => (
          <button
            type="button"
            className="search-result"
            key={i}
            onClick={() => {
              setCoords({ lat: r.properties.lat, lon: r.properties.lon });
              setAddress(r.properties.formatted);
              setResults([]);
            }}
          >
            {r.properties.formatted}
          </button>
        ))}
        {geo && (
          <p className="fineprint">
            Location search by{" "}
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
        <div className="form-grid">
          <Field label="Latitude">
            <input
              type="number"
              step="any"
              min="-90"
              max="90"
              required
              value={coords.lat}
              onChange={(e) =>
                setCoords({ ...coords, lat: Number(e.target.value) })
              }
            />
          </Field>
          <Field label="Longitude">
            <input
              type="number"
              step="any"
              min="-180"
              max="180"
              required
              value={coords.lon}
              onChange={(e) =>
                setCoords({ ...coords, lon: Number(e.target.value) })
              }
            />
          </Field>
        </div>
        <button type="button" className="btn subtle" onClick={locate}>
          <LocateFixed size={16} /> Use my current location
        </button>
        <Field label="Entrance and access instructions">
          <textarea
            name="entrance"
            maxLength={2000}
            defaultValue={site?.entrance}
            placeholder="Which gate, approach road or loading point?"
          />
        </Field>
        <Field label="Site contact (optional)">
          <input
            name="contact"
            maxLength={200}
            defaultValue={site?.contact}
            placeholder="Contact name or work phone"
          />
        </Field>
        <Field label="Additional notes">
          <textarea name="notes" maxLength={3000} defaultValue={site?.notes} />
        </Field>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <footer>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy}>
            Save site
          </button>
        </footer>
      </form>
    </Modal>
  );
}
export function ReportForm({
  sites,
  identity,
  onSave,
  onClose,
  defaultSite,
}: {
  sites: Site[];
  identity: Identity;
  onSave: (e: Entity) => Promise<void>;
  onClose: () => void;
  defaultSite?: string;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [photo, setPhoto] = useState<string>("");
  async function image(file?: File) {
    if (!file) return;
    if (
      !/^image\/(jpeg|png|webp)$/.test(file.type) ||
      file.size > 12 * 1024 * 1024
    ) {
      setError("Choose a JPEG, PNG or WebP image up to 12 MB.");
      return;
    }
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 640 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas
      .getContext("2d")!
      .drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    let data = canvas.toDataURL("image/jpeg", 0.6);
    if (data.length > 55000) data = canvas.toDataURL("image/jpeg", 0.3);
    bitmap.close();
    if (data.length > 55000) {
      setError(
        "This photo is too large after compression. Choose a smaller image.",
      );
      return;
    }
    setPhoto(data);
    setError("");
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const f = new FormData(e.currentTarget);
    const observed = new Date(String(f.get("observedAt")));
    if (observed.getTime() > Date.now() + 60000) {
      setError("Observation time cannot be in the future.");
      setBusy(false);
      return;
    }
    const id = uid();
    try {
      await onSave({
        id,
        kind: "report",
        revision: 0,
        updatedAt: new Date().toISOString(),
        title: String(f.get("title")).trim(),
        siteId: String(f.get("siteId")),
        severity: String(f.get("severity")) as Report["severity"],
        category: String(f.get("category")) as Report["category"],
        observedAt: observed.toISOString(),
        expiresAt: new Date(
          observed.getTime() + Number(f.get("validHours")) * 3600000,
        ).toISOString(),
        vehicle: String(f.get("vehicle")),
        notes: String(f.get("notes")).trim(),
        authorId: identity.id,
        verified: false,
      });
      if (photo)
        await onSave({
          id: uid(),
          kind: "photo",
          revision: 0,
          updatedAt: new Date().toISOString(),
          reportId: id,
          data: photo,
          caption: "Field observation photo",
        });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Share an access observation" onClose={onClose}>
      <form onSubmit={submit}>
        <p className="form-intro">
          Record what you observed and when. A report is evidence for a
          decision, not a guarantee of access.
        </p>
        <Field label="What did you observe?">
          <input
            name="title"
            required
            maxLength={160}
            placeholder="e.g. Main entrance closed for repairs"
          />
        </Field>
        <div className="form-grid">
          <Field label="Affected site">
            <select name="siteId" required defaultValue={defaultSite}>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Category">
            <select name="category">
              <option value="road">Road condition</option>
              <option value="crossing">Crossing or bridge</option>
              <option value="entrance">Site entrance</option>
              <option value="weather">Weather exposure</option>
              <option value="other">Other</option>
            </select>
          </Field>
          <Field label="Access impact">
            <select name="severity">
              <option value="info">Information</option>
              <option value="caution">Caution / verify access</option>
              <option value="blocked">Access reported blocked</option>
            </select>
          </Field>
          <Field label="Relevant vehicle">
            <select name="vehicle">
              {vehicles.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </Field>
          <Field label="Observed at">
            <input
              name="observedAt"
              type="datetime-local"
              required
              defaultValue={localDate(new Date().toISOString())}
            />
          </Field>
          <Field label="Review again after">
            <select name="validHours">
              <option value="6">6 hours</option>
              <option value="24">24 hours</option>
              <option value="72">3 days</option>
              <option value="168">7 days</option>
            </select>
          </Field>
        </div>
        <Field label="Details">
          <textarea
            name="notes"
            required
            maxLength={3000}
            placeholder="Describe the approach, vehicle/load context and what needs checking."
          />
        </Field>
        <label className="photo-input">
          <ImagePlus size={18} />{" "}
          {photo ? "Replace attached photo" : "Add a photo (optional)"}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) =>
              image(e.target.files?.[0]).catch(() =>
                setError("Could not process this image."),
              )
            }
          />
        </label>
        {photo && (
          <img
            src={photo}
            className="photo-preview"
            alt="Observation attachment preview"
          />
        )}
        <small className="muted">
          The report saves first; the compressed photo has its own upload
          receipt.
        </small>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <footer>
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy || !sites.length}>
            Save observation
          </button>
        </footer>
      </form>
    </Modal>
  );
}
