import { CatalogCustomScopingPanel } from "../components/CatalogCustomScopingPanel";

export function CatalogCustomSolutionsView() {
  return (
    <div className="agency-view-shell agency-view-shell--catalog">
      <p className="agency-catalog-lede">Click a row for details.</p>
      <CatalogCustomScopingPanel />
    </div>
  );
}
