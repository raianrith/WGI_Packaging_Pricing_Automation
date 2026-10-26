import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { ProposalDraftGuardProvider } from "./context/ProposalDraftGuardContext";
import { ToastProvider } from "./context/ToastContext";
import { ProtectedLayout } from "./components/ProtectedLayout";
import { AgencyPackageBuilderView } from "./views/AgencyPackageBuilderView";
import { AgencyHomeView } from "./views/AgencyHomeView";
import { AgencyTabsShell } from "./views/AgencyTabsShell";
import { AgencyView } from "./views/AgencyView";
import { RequireAdmin } from "./components/RequireAdmin";
import { AdminView } from "./views/AdminView";
import { AuthPage } from "./views/AuthPage";
import { RoadmapPlanningView } from "./views/RoadmapPlanningView";
import { SolutionRequestsView } from "./views/SolutionRequestsView";
import { CatalogCustomSolutionsView } from "./views/CatalogCustomSolutionsView";

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
          <Route path="/roadmap/:proposalId" element={<RoadmapPlanningView />} />
          <Route path="/package-builder" element={<AgencyPackageBuilderView />} />
          <Route path="/solution-requests" element={<SolutionRequestsView />} />
          <Route path="/" element={<AgencyHomeView />} />
          <Route element={<AgencyTabsShell />}>
            <Route path="solutions" element={<AgencyView mode="catalog" catalogSubview="directory" />} />
            <Route path="directory-details" element={<AgencyView mode="catalog" catalogSubview="detail" />} />
            <Route path="custom-solutions" element={<CatalogCustomSolutionsView />} />
          </Route>
          <Route path="packages" element={<Navigate to="/solutions?type=packages" replace />} />
          <Route path="package/standalone" element={<Navigate to="/solutions" replace />} />
          <Route path="package/:packageId" element={<AgencyView mode="package" />} />
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
