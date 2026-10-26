import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "../context/AuthContext";
import { displayInitial } from "../lib/displayName";

function SignOutButton() {
  const { signOut } = useAuth();
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      className="app-user-menu__signout"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void signOut().finally(() => setBusy(false));
      }}
    >
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}

export function AppUserMenu() {
  const { user, displayName, updateDisplayName } = useAuth();
  const email = user?.email ?? "Account";
  const nameId = useId();
  const panelId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [panelPos, setPanelPos] = useState({ top: 0, right: 0 });

  const placePanel = () => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPanelPos({
      top: r.bottom + 8,
      right: Math.max(12, window.innerWidth - r.right),
    });
  };

  const openEditor = () => {
    setDraft(displayName ?? "");
    setError(null);
    placePanel();
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    inputRef.current?.select();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (wrapRef.current?.contains(target)) return;
      const panel = document.getElementById(panelId);
      if (panel?.contains(target)) return;
      setOpen(false);
    };
    const onResize = () => placePanel();
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
    };
  }, [open, panelId]);

  const save = async () => {
    setSaving(true);
    setError(null);
    const { error: saveError } = await updateDisplayName(draft);
    setSaving(false);
    if (saveError) {
      setError(saveError);
      return;
    }
    setOpen(false);
  };

  const panel =
    open && typeof document !== "undefined"
      ? createPortal(
          <form
            id={panelId}
            className="app-user-menu__panel"
            style={{ top: panelPos.top, right: panelPos.right }}
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <p className="app-user-menu__panel-kicker">Account</p>
            <label className="app-user-menu__panel-label" htmlFor={nameId}>
              Display name
            </label>
            <input
              ref={inputRef}
              id={nameId}
              className="app-user-menu__panel-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={80}
              autoComplete="name"
              placeholder="Your name"
              aria-invalid={Boolean(error)}
            />
            <p className="app-user-menu__panel-hint">
              Shown on Home and to teammates who are online. Your email stays {email}.
            </p>
            {error ? (
              <p className="app-user-menu__panel-error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="app-user-menu__panel-actions">
              <button type="button" className="app-user-menu__panel-cancel" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="app-user-menu__panel-save" disabled={saving}>
                {saving ? "Saving…" : "Save name"}
              </button>
            </div>
          </form>,
          document.body
        )
      : null;

  return (
    <div className="app-user-menu" ref={wrapRef}>
      <button
        type="button"
        className="app-user-menu__identity"
        onClick={() => (open ? setOpen(false) : openEditor())}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        title="Change display name"
      >
        <span className="app-user-menu__avatar" aria-hidden>
          {displayInitial(displayName, email)}
        </span>
        <span className="app-user-menu__details">
          <span className="app-user-menu__name">{displayName || "Add your name"}</span>
          <span className="app-user-menu__email" title={email}>
            {email}
          </span>
        </span>
      </button>
      <SignOutButton />
      {panel}
    </div>
  );
}
