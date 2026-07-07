import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { NAV_SOLUTIONS_OVERVIEW } from "../branding";
import { useAuth } from "../context/AuthContext";

/** Only renders `children` when `profiles.is_admin` is true for the signed-in user. */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { profileLoading, isAdmin } = useAuth();

  if (profileLoading) {
    return (
      <div className="auth-loading-screen auth-loading-screen--embedded" aria-busy aria-live="polite">
        <div className="auth-loading-screen__spinner" />
        <p className="auth-loading-screen__text">Checking access…</p>
      </div>
    );
  }

  if (!isAdmin) {
    return <AdminAccessDenied />;
  }

  return <>{children}</>;
}

function AdminAccessDenied() {
  return (
    <div className="admin-access-denied">
      <div className="admin-access-denied__card">
        <p className="admin-access-denied__eyebrow">Admin workspace</p>
        <h1 className="admin-access-denied__title">You don’t have access</h1>
        <p className="admin-access-denied__body">
          Your account isn’t marked as an admin yet. An owner can set{" "}
          <code className="admin-access-denied__code">profiles.is_admin</code> for your user in Supabase
          (SQL or Table Editor).
        </p>
        <Link className="admin-access-denied__link" to="/">
          ← Back to {NAV_SOLUTIONS_OVERVIEW}
        </Link>
      </div>
    </div>
  );
}
