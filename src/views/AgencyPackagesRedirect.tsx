import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import {
  browserKeyConfigurationError,
  envConfigured,
  getSupabase,
} from "../lib/supabase";

function sortId(a: string, b: string): number {
  const pa = a.split("-").map(Number);
  const pb = b.split("-").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na !== nb) return na - nb;
  }
  return a.localeCompare(b);
}

/**
 * Packages tab entry: skip the card hub and open the first package workspace directly.
 */
export function AgencyPackagesRedirect() {
  const [target, setTarget] = useState<string | null>(null);
  const [noPackages, setNoPackages] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const keyErr = browserKeyConfigurationError();
      if (keyErr || !envConfigured()) {
        if (!cancelled) setNoPackages(true);
        return;
      }
      const client = getSupabase();
      if (!client) {
        if (!cancelled) setNoPackages(true);
        return;
      }
      const { data, error } = await client.from("packages").select("package_id");
      if (cancelled) return;
      if (error || !data?.length) {
        setNoPackages(true);
        return;
      }
      const sorted = [...data].sort((a, b) => sortId(a.package_id, b.package_id));
      const first = sorted[0]?.package_id;
      if (!first) {
        setNoPackages(true);
        return;
      }
      setTarget(`/package/${encodeURIComponent(first)}`);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (target) return <Navigate to={target} replace />;
  if (noPackages) return <Navigate to="/" replace />;

  return (
    <div className="agency-view-shell" style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>
      Loading packages…
    </div>
  );
}
