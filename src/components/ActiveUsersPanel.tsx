import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { getSupabase } from "../lib/supabase";
import {
  ACTIVE_NOW_WINDOW_MS,
  ACTIVE_RECENT_WINDOW_MS,
  formatPresenceLocalDateTime,
  formatPresenceRelativeTime,
  presenceStatus,
  routePresenceLabel,
} from "../lib/userPresence";
import type { UserPresenceRow } from "../types";

type Props = {
  styles: {
    panel: CSSProperties;
    h2: CSSProperties;
    muted: CSSProperties;
    tbl: CSSProperties;
    th: CSSProperties;
    td: CSSProperties;
    btnSm: CSSProperties;
    input: CSSProperties;
  };
};

const AUTO_REFRESH_MS = 30 * 1000;

export function ActiveUsersPanel({ styles }: Props) {
  const { panel, h2, muted, tbl, th, td, btnSm, input } = styles;
  const [rows, setRows] = useState<UserPresenceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const client = getSupabase();
    if (!client) {
      setRows([]);
      setLoadErr("Supabase client not available.");
      setLoading(false);
      return;
    }
    if (!opts?.silent) setLoading(true);
    const cutoff = new Date(Date.now() - ACTIVE_RECENT_WINDOW_MS).toISOString();
    const { data, error } = await client
      .from("user_presence")
      .select("*")
      .gte("last_seen_at", cutoff)
      .order("last_seen_at", { ascending: false })
      .limit(100);
    if (error) {
      setRows([]);
      setLoadErr(
        error.message.toLowerCase().includes("user_presence")
          ? "Run supabase/user_presence.sql in Supabase, then reload this tab."
          : error.message
      );
      setLoading(false);
      return;
    }
    setRows((data ?? []) as UserPresenceRow[]);
    setLoadErr(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void load({ silent: true });
    }, AUTO_REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load({ silent: true });
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  const now = Date.now();
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => {
      const hay =
        `${row.full_name ?? ""} ${row.email ?? ""} ${row.current_path ?? ""} ${routePresenceLabel(row.current_path)}`.toLowerCase();
      return hay.includes(q);
    });
  }, [rows, search]);

  const activeNowCount = filtered.filter((row) => presenceStatus(row.last_seen_at, now) === "active_now").length;
  const recentCount = filtered.filter((row) => presenceStatus(row.last_seen_at, now) === "recent").length;

  return (
    <section className="admin-panel admin-panel--editor" style={panel}>
      <div className="admin-editor-layout admin-editor-layout--wide">
        <h2 style={h2}>Active Users</h2>
        <p className="admin-intro" style={muted}>
          Shows signed-in users with a recent heartbeat from the app shell. <strong>Active now</strong> means seen
          within {Math.round(ACTIVE_NOW_WINDOW_MS / 60000)} minutes; rows auto-refresh every 30 seconds.
        </p>

        <div className="admin-presence-toolbar">
          <input
            className="admin-field kb-filter-input"
            style={{ ...input, marginTop: 0, flex: "1 1 240px", maxWidth: 420 }}
            placeholder="Search name, email, or app area…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button type="button" style={btnSm} onClick={() => void load()} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        <div className="admin-presence-summary">
          <div className="admin-presence-summary__card">
            <span className="admin-presence-summary__value">{activeNowCount}</span>
            <span className="admin-presence-summary__label">Active now</span>
          </div>
          <div className="admin-presence-summary__card">
            <span className="admin-presence-summary__value">{recentCount}</span>
            <span className="admin-presence-summary__label">Recently active</span>
          </div>
          <p className="admin-hint" style={{ ...muted, margin: 0 }}>
            Showing {filtered.length} recent user{filtered.length === 1 ? "" : "s"} from the last{" "}
            {Math.round(ACTIVE_RECENT_WINDOW_MS / 60000)} minutes.
          </p>
        </div>

        {loadErr ? (
          <p className="admin-hint" style={{ ...muted, color: "#9f1239" }}>
            {loadErr}
          </p>
        ) : null}

        <div className="admin-table-scroll" style={{ marginTop: 12 }}>
          <table className="admin-data-table admin-presence-table" style={tbl}>
            <thead>
              <tr>
                <th style={th}>User</th>
                <th style={th}>Email</th>
                <th style={th}>Current area</th>
                <th style={th}>Status</th>
                <th style={th}>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {!loading && filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} style={td}>
                    No active users right now.
                  </td>
                </tr>
              ) : null}
              {filtered.map((row) => {
                const status = presenceStatus(row.last_seen_at, now);
                const badgeClass =
                  status === "active_now"
                    ? "admin-presence-badge admin-presence-badge--active"
                    : status === "recent"
                      ? "admin-presence-badge admin-presence-badge--recent"
                      : "admin-presence-badge";
                const name = row.full_name?.trim() || row.email?.split("@")[0] || "Unknown user";
                return (
                  <tr key={row.user_id}>
                    <td style={td}>
                      <strong>{name}</strong>
                    </td>
                    <td style={td}>{row.email || "—"}</td>
                    <td style={td}>
                      <div>{routePresenceLabel(row.current_path)}</div>
                      {row.current_path ? (
                        <div style={{ ...muted, marginTop: 2, fontSize: "0.78rem" }}>
                          <code>{row.current_path}</code>
                        </div>
                      ) : null}
                    </td>
                    <td style={td}>
                      <span className={badgeClass}>
                        {status === "active_now" ? "Active now" : status === "recent" ? "Recently active" : "Inactive"}
                      </span>
                    </td>
                    <td style={td}>
                      <div>{formatPresenceRelativeTime(row.last_seen_at, now)}</div>
                      <div style={{ ...muted, marginTop: 2, fontSize: "0.78rem" }}>
                        {formatPresenceLocalDateTime(row.last_seen_at)}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
