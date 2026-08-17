import { useCallback, useState, type CSSProperties } from "react";
import { Link, useNavigate } from "react-router-dom";
import { stashCatalogTierNavigation } from "../lib/catalogTierNavigation";
import { resolveMigratedPackageTarget } from "../lib/packageMigrations";
import { AGENCY_HOME_DESCRIPTION, AGENCY_HOME_TITLE } from "../branding";
import {
  GuidedTierBrowser,
  type GuidedSelection,
} from "../components/GuidedTierBrowser";
import { useVaultCatalogRows } from "../hooks/useVaultCatalogRows";

const shell: CSSProperties = {
  width: "100%",
  padding: "1rem 0 2.5rem",
};

export function AgencyHomeView() {
  const navigate = useNavigate();
  const catalog = useVaultCatalogRows();
  const [selection, setSelection] = useState<GuidedSelection>({
    phase: null,
    category: null,
    tactic: null,
  });

  const openTier = useCallback(
    (solutionId: string, tierId: string) => {
      stashCatalogTierNavigation({ solutionId, tierId });
      navigate("/directory-details", {
        state: { openTierDetail: { solutionId, tierId } },
      });
    },
    [navigate]
  );

  const openPackageType = useCallback(
    (packageTypeId: string) => {
      navigate("/package-builder", {
        state: { packageBuilderTypeId: packageTypeId },
      });
    },
    [navigate]
  );

  const openPresetPackage = useCallback(
    (packageId: string) => {
      if (catalog.status === "ok") {
        const target = resolveMigratedPackageTarget(
          packageId,
          catalog.packageMigrations,
          catalog.tiers
        );
        if (target) {
          stashCatalogTierNavigation(target);
          navigate("/directory-details", { state: { openTierDetail: target } });
          return;
        }
      }
      navigate(`/package/${encodeURIComponent(packageId)}`);
    },
    [catalog, navigate]
  );

  return (
    <div className="agency-home-view" style={shell}>
      <div className="agency-home-view__glow" aria-hidden />
      <header className="agency-home-guide__hero">
        <div className="agency-home-guide__hero-top">
          <span className="agency-hub__eyebrow">Guided Browse</span>
          {catalog.status === "ok" ? (
            <button
              type="button"
              className="agency-hub__refresh"
              onClick={catalog.reload}
              aria-label="Refresh vault data"
            >
              Refresh
            </button>
          ) : null}
        </div>
        <h1 className="agency-hub__title">{AGENCY_HOME_TITLE}</h1>
        <p className="agency-hub__lede">
          {AGENCY_HOME_DESCRIPTION} Or browse the full{" "}
          <Link className="agency-hub__link" to="/solutions">
            All Solutions & Packages
          </Link>{" "}
          and{" "}
          <Link className="agency-hub__link" to="/packages">
            Packages
          </Link>{" "}
          workspaces.
        </p>
      </header>

      {catalog.status === "loading" || catalog.status === "idle" ? (
        <div className="agency-home-guide__loading" role="status">
          Loading playbook solutions from Supabase…
        </div>
      ) : null}

      {catalog.status === "error" ? (
        <p className="agency-home-guide__error" role="alert">
          {catalog.message}
        </p>
      ) : null}

      {catalog.status === "ok" ? (
        <GuidedTierBrowser
          allRows={catalog.rows}
          packageTypes={catalog.packageTypes}
          presetPackages={catalog.presetPackages}
          packageBuilderSlots={catalog.packageBuilderSlots}
          selection={selection}
          onSelectionChange={setSelection}
          onOpenTier={openTier}
          onOpenPackageType={openPackageType}
          onOpenPresetPackage={openPresetPackage}
        />
      ) : null}
    </div>
  );
}
