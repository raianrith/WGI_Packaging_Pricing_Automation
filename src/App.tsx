import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { ProposalDraftGuardProvider } from "./context/ProposalDraftGuardContext";
import { ToastProvider } from "./context/ToastContext";
import { ProtectedLayout } from "./components/ProtectedLayout";
import { AgencyPackagesHub } from "./views/AgencyPackagesHub";
import { AgencyPackageBuilderView } from "./views/AgencyPackageBuilderView";
import { AgencyTabsShell } from "./views/AgencyTabsShell";
import { AgencyHomeView } from "./views/AgencyHomeView";
import { AgencyView } from "./views/AgencyView";
import { RequireAdmin } from "./components/RequireAdmin";
import { AdminView } from "./views/AdminView";
import { AuthPage } from "./views/AuthPage";
import { RoadmapPlanningView } from "./views/RoadmapPlanningView";

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
      <ProposalDraftGuardProvider>
      <Routes>
        <Route path="/login" element={<AuthPage />} />
        <Route element={<ProtectedLayout />}>
          <Route path="/catalog" element={<Navigate to="/solutions" replace />} />
          <Route path="/roadmap" element={<RoadmapPlanningView />} />
          <Route path="/package-builder" element={<AgencyPackageBuilderView />} />
          <Route path="/" element={<AgencyTabsShell />}>
            <Route index element={<AgencyHomeView />} />
            <Route path="solutions" element={<AgencyView mode="catalog" catalogSubview="directory" />} />
            <Route path="directory-details" element={<AgencyView mode="catalog" catalogSubview="detail" />} />
            <Route path="packages" element={<AgencyPackagesHub />} />
            <Route path="package/standalone" element={<Navigate to="/solutions" replace />} />
            <Route path="package/:packageId" element={<AgencyView mode="package" />} />
          </Route>
          <Route
            path="/admin"
            element={<Navigate to="/admin/vault" replace />}
          />
          <Route
            path="/admin/*"
            element={
              <RequireAdmin>
                <AdminView />
              </RequireAdmin>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      </ProposalDraftGuardProvider>
      </ToastProvider>
    </AuthProvider>
  );
}
