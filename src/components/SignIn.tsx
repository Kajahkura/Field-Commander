import { useState } from "react";
import { Compass, KeyRound, Loader2 } from "lucide-react";
import { Field } from "./Modal";
export function SignIn({
  onLogin,
  message,
  online,
}: {
  onLogin: (key: string) => Promise<void>;
  message: string;
  online: boolean;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <main className="sign-in">
      <section className="sign-in-story">
        <a className="sign-in-brand" href="/" aria-label="Field Commander home">
          <Compass size={30} /> Field Commander
        </a>
        <h1>Give every field visit the context it needs.</h1>
        <p>
          Coordinate assignments, check access conditions, and capture
          evidence—even when your team loses its connection.
        </p>
        <img
          src="/operations-landscape.webp"
          alt="Illustration of field teams connecting a clinic, warehouse and service site"
          width="1536"
          height="1024"
        />
        <p className="sign-in-caption">
          For delivery, maintenance and community service teams.
        </p>
      </section>
      <section className="sign-in-panel" aria-labelledby="sign-in-title">
        <h2 id="sign-in-title">Sign in to your workspace</h2>
        <p>
          Use the access key your workspace owner gave you. Each team member has
          a separate key.
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            const key = String(
              new FormData(e.currentTarget).get("key") || "",
            ).trim();
            try {
              await onLogin(key);
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field
            label="Your access key"
            hint="Your key stays in this browser session. Keep it private."
          >
            <input
              name="key"
              type="password"
              autoComplete="off"
              required
              minLength={32}
              maxLength={160}
              spellCheck={false}
              placeholder="Paste your access key"
            />
          </Field>
          {(error || message) && (
            <p className="form-error" role="alert">
              {error || message}
            </p>
          )}
          {!online && (
            <p role="status">
              A connection is required to sign in. An existing session can
              reopen its saved records offline.
            </p>
          )}
          <button className="btn primary" disabled={busy || !online}>
            {busy ? (
              <Loader2 className="spin" size={18} />
            ) : (
              <KeyRound size={18} />
            )}{" "}
            {busy ? "Checking your access…" : "Sign in"}
          </button>
        </form>
        <p className="sign-in-help">
          Need access or a replacement key? Contact your workspace owner.
        </p>
      </section>
    </main>
  );
}
