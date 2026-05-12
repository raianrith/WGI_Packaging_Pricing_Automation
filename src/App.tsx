import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { ToastProvider } from "./context/ToastContext";
import { ProtectedLayout } from "./components/ProtectedLayout";
import { AgencyPackagesHub } from "./views/AgencyPackagesHub";
import { AgencyTabsShell } from "./views/AgencyTabsShell";
import { AgencyView } from "./views/AgencyView";
import { RequireAdmin } from "./components/RequireAdmin";
import { AdminView } from "./views/AdminView";
import { AuthPage } from "./views/AuthPage";
import { RoadmapPlanningView } from "./views/RoadmapPlanningView";

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
      <Routes>
        <Route path="/login" element={<AuthPage />} />
        <Route element={<ProtectedLayout />}>
          <Route path="/catalog" element={<Navigate to="/" replace />} />
          <Route path="/roadmap" element={<RoadmapPlanningView />} />
          <Route path="/" element={<AgencyTabsShell />}>
            <Route index element={<AgencyView mode="catalog" />} />
            <Route path="packages" element={<AgencyPackagesHub />} />
            <Route path="package/standalone" element={<Navigate to="/" replace />} />
            <Route path="package/:packageId" element={<AgencyView mode="package" />} />
          </Route>
          <Route
            path="/admin"
            element={
              <RequireAdmin>
                <AdminView />
              </RequireAdmin>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      </ToastProvider>
    </AuthProvider>
  );
}
