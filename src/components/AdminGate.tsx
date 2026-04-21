import { type FormEvent, type ReactNode, useState } from "react";

const ADMIN_PASSWORD = "chelseaforpresident";

type Props = {
  children: ReactNode;
};

export function AdminGate({ children }: Props) {
  const [unlocked, setUnlocked] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password === ADMIN_PASSWORD) {
      setUnlocked(true);
      setPassword("");
      return;
    }
    setError("Incorrect password.");
    setPassword("");
  }

  if (unlocked) {
    return <>{children}</>;
  }

  return (
    <div className="admin-gate">
      <form className="admin-gate__card" onSubmit={onSubmit}>
        <h1 className="admin-gate__title">Admin access</h1>
        <p className="admin-gate__hint">
          Enter the admin password to manage packaging and pricing data.
        </p>
        <label className="admin-gate__label">
          Password
          <input
            className="admin-gate__input kb-filter-input"
            type="password"
            name="admin-password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error ? (
          <p className="admin-gate__err" role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" className="admin-gate__submit">
          Unlock admin
        </button>
      </form>
    </div>
  );
}
