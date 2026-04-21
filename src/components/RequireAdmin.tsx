import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export function RequireAdmin({ children }: { children: ReactNode }) {
  const { profile, loading } = useAuth();

  if (loading) {
    return (
      <div className="auth-loading">
        <p className="auth-loading__text">Checking session…</p>
      </div>
    );
  }

  if (!profile?.is_admin) {
    return (
      <div className="admin-gate">
        <div className="admin-gate__card" style={{ maxWidth: 420 }}>
          <h1 className="admin-gate__title">Admin access</h1>
          <p className="admin-gate__hint">
            Your account does not have admin privileges. Contact an administrator if you need
            access to data management tools.
          </p>
          <Link className="agency-btn-secondary" to="/" style={{ marginTop: "1rem", display: "inline-block", textAlign: "center", textDecoration: "none" }}>
            Back to Agency view
          </Link>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
