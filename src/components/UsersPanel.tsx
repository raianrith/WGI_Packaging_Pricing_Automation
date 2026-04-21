import { type FormEvent, useCallback, useEffect, useState } from "react";
import { getSupabase } from "../lib/supabase";
import { invokeAdminUsers } from "../lib/adminUsersApi";
import type { ProfileRow } from "../types";
import { useAuth } from "../context/AuthContext";

type Props = {
  setOpErr: (s: string | null) => void;
  setOpOk: (s: string | null) => void;
};

export function UsersPanel({ setOpErr, setOpOk }: Props) {
  const { session, refreshProfile } = useAuth();
  const [rows, setRows] = useState<ProfileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [listErr, setListErr] = useState<string | null>(null);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isAdminNew, setIsAdminNew] = useState(false);
  const [creating, setCreating] = useState(false);

  const [pwTargetId, setPwTargetId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [pwBusy, setPwBusy] = useState(false);

  const load = useCallback(async () => {
    setListErr(null);
    const client = getSupabase();
    if (!client) {
      setListErr("Supabase client unavailable.");
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await client
      .from("profiles")
      .select("id, full_name, email, is_admin, created_at, updated_at")
      .order("email", { ascending: true, nullsFirst: false });
    setLoading(false);
    if (error) {
      setListErr(
        error.message.includes("profiles") || error.code === "PGRST205"
          ? "Run supabase/profiles_and_auth.sql in the SQL Editor, then refresh."
          : error.message
      );
      setRows([]);
      return;
    }
    setRows((data ?? []) as ProfileRow[]);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setOpErr(null);
    setOpOk(null);
    const client = getSupabase();
    if (!client) return;
    setCreating(true);
    const res = await invokeAdminUsers(client, {
      action: "create",
      email: email.trim().toLowerCase(),
      password,
      full_name: fullName.trim(),
      is_admin: isAdminNew,
    });
    setCreating(false);
    if (!res.ok) {
      setOpErr(res.message);
      return;
    }
    setOpOk("User created.");
    setFullName("");
    setEmail("");
    setPassword("");
    setIsAdminNew(false);
    await load();
    if (session?.user.id === res.user_id) {
      await refreshProfile();
    }
  }

  async function onToggleAdmin(row: ProfileRow, nextAdmin: boolean) {
    setOpErr(null);
    setOpOk(null);
    const client = getSupabase();
    if (!client) return;

    if (row.is_admin && !nextAdmin) {
      const { count, error: cErr } = await client
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("is_admin", true);
      if (cErr) {
        setOpErr(cErr.message);
        return;
      }
      if ((count ?? 0) <= 1) {
        setOpErr("At least one admin user is required.");
        return;
      }
    }

    const { error } = await client
      .from("profiles")
      .update({ is_admin: nextAdmin })
      .eq("id", row.id);
    if (error) {
      setOpErr(error.message);
      return;
    }
    setOpOk("Access updated.");
    await load();
    if (session?.user.id === row.id) {
      await refreshProfile();
    }
  }

  async function onSaveFullName(row: ProfileRow, name: string) {
    setOpErr(null);
    setOpOk(null);
    const client = getSupabase();
    if (!client) return;
    const { error } = await client
      .from("profiles")
      .update({ full_name: name.trim() })
      .eq("id", row.id);
    if (error) {
      setOpErr(error.message);
      return;
    }
    setOpOk("Name saved.");
    await load();
    if (session?.user.id === row.id) {
      await refreshProfile();
    }
  }

  async function onSubmitPassword(e: FormEvent) {
    e.preventDefault();
    if (!pwTargetId) return;
    setOpErr(null);
    setOpOk(null);
    const client = getSupabase();
    if (!client) return;
    setPwBusy(true);
    const res = await invokeAdminUsers(client, {
      action: "update_password",
      user_id: pwTargetId,
      password: newPassword,
    });
    setPwBusy(false);
    if (!res.ok) {
      setOpErr(res.message);
      return;
    }
    setOpOk("Password updated.");
    setPwTargetId(null);
    setNewPassword("");
  }

  async function onDelete(row: ProfileRow) {
    if (
      !window.confirm(
        `Remove access for ${row.email ?? row.id}? This deletes the login permanently.`
      )
    ) {
      return;
    }
    setOpErr(null);
    setOpOk(null);
    const client = getSupabase();
    if (!client) return;
    const res = await invokeAdminUsers(client, { action: "delete", user_id: row.id });
    if (!res.ok) {
      setOpErr(res.message);
      return;
    }
    setOpOk("User deleted.");
    await load();
  }

  return (
    <section className="admin-panel admin-panel--editor">
      <div className="admin-editor-layout admin-editor-layout--wide">
        <h2 className="admin-block-title">Users</h2>
        <p className="admin-intro" style={{ color: "var(--muted)", marginTop: 0 }}>
          Create logins here (no public sign up). New users receive the password you set; share it
          securely. Deploy the <code className="login-page__code">admin-users</code> Edge Function
          for create / delete / password reset (see comments in{" "}
          <code className="login-page__code">supabase/profiles_and_auth.sql</code>).
        </p>

        {listErr && (
          <div className="admin-banner admin-banner--err" role="alert" style={{ marginTop: "0.75rem" }}>
            {listErr}
          </div>
        )}

        <div className="users-panel__create">
          <h3 className="users-panel__subhead">Add user</h3>
          <form className="users-panel__create-form" onSubmit={onCreate}>
            <label className="admin-gate__label">
              Full name
              <input
                className="admin-gate__input kb-filter-input"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
              />
            </label>
            <label className="admin-gate__label">
              Email
              <input
                className="admin-gate__input kb-filter-input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            <label className="admin-gate__label">
              Initial password
              <input
                className="admin-gate__input kb-filter-input"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                required
              />
            </label>
            <label className="users-panel__check">
              <input
                type="checkbox"
                checked={isAdminNew}
                onChange={(e) => setIsAdminNew(e.target.checked)}
              />
              Admin privileges
            </label>
            <button type="submit" className="admin-gate__submit" disabled={creating}>
              {creating ? "Creating…" : "Create user"}
            </button>
          </form>
        </div>

        <h3 className="users-panel__subhead" style={{ marginTop: "1.75rem" }}>
          All users
        </h3>
        {loading ? (
          <p className="admin-hint" style={{ color: "var(--muted)" }}>
            Loading…
          </p>
        ) : (
          <div className="admin-table-scroll" style={{ marginTop: 10 }}>
            <table className="admin-data-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Name</th>
                  <th>Admin</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <UserRow
                    key={row.id}
                    row={row}
                    currentUserId={session?.user.id ?? ""}
                    onToggleAdmin={onToggleAdmin}
                    onSaveFullName={onSaveFullName}
                    onDelete={onDelete}
                    onSetPassword={() => {
                      setPwTargetId(row.id);
                      setNewPassword("");
                      setOpErr(null);
                      setOpOk(null);
                    }}
                  />
                ))}
              </tbody>
            </table>
            {rows.length === 0 && !listErr && (
              <p className="admin-hint" style={{ color: "var(--muted)" }}>
                No profiles yet. Run the SQL migration and create a user from the Supabase Dashboard,
                then promote them with SQL (see migration header).
              </p>
            )}
          </div>
        )}

        {pwTargetId && (
          <div className="users-panel__modal">
            <form className="users-panel__modal-card" onSubmit={onSubmitPassword}>
              <h4 className="users-panel__modal-title">Set password</h4>
              <p className="admin-hint" style={{ color: "var(--muted)", marginTop: 0 }}>
                Minimum 8 characters.
              </p>
              <label className="admin-gate__label">
                New password
                <input
                  className="admin-gate__input kb-filter-input"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  minLength={8}
                  required
                />
              </label>
              <div className="users-panel__modal-actions">
                <button type="submit" className="admin-gate__submit" disabled={pwBusy}>
                  {pwBusy ? "Saving…" : "Save password"}
                </button>
                <button
                  type="button"
                  className="agency-btn-secondary"
                  onClick={() => {
                    setPwTargetId(null);
                    setNewPassword("");
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </section>
  );
}

function UserRow({
  row,
  currentUserId,
  onToggleAdmin,
  onSaveFullName,
  onDelete,
  onSetPassword,
}: {
  row: ProfileRow;
  currentUserId: string;
  onToggleAdmin: (row: ProfileRow, next: boolean) => void;
  onSaveFullName: (row: ProfileRow, name: string) => void;
  onDelete: (row: ProfileRow) => void;
  onSetPassword: () => void;
}) {
  const [nameEdit, setNameEdit] = useState(row.full_name);
  useEffect(() => {
    setNameEdit(row.full_name);
  }, [row.full_name]);

  return (
    <tr>
      <td>{row.email ?? "—"}</td>
      <td>
        <div className="users-panel__name-cell">
          <input
            className="admin-gate__input kb-filter-input"
            style={{ marginTop: 0, maxWidth: 220 }}
            value={nameEdit}
            onChange={(e) => setNameEdit(e.target.value)}
          />
          <button
            type="button"
            className="agency-btn-secondary"
            style={{ fontSize: "0.78rem", padding: "0.35rem 0.6rem" }}
            onClick={() => void onSaveFullName(row, nameEdit)}
          >
            Save name
          </button>
        </div>
      </td>
      <td>
        <label className="users-panel__check" style={{ margin: 0 }}>
          <input
            type="checkbox"
            checked={row.is_admin}
            onChange={(e) => void onToggleAdmin(row, e.target.checked)}
          />
          Admin
        </label>
      </td>
      <td>
        <div className="users-panel__row-actions">
          <button type="button" className="agency-btn-secondary" onClick={onSetPassword}>
            Set password
          </button>
          <button
            type="button"
            className="agency-btn-secondary"
            style={{ color: "var(--danger)", borderColor: "rgba(185, 28, 28, 0.35)" }}
            disabled={row.id === currentUserId}
            onClick={() => void onDelete(row)}
          >
            Delete
          </button>
        </div>
      </td>
    </tr>
  );
}
