import { useCallback, useState } from "react";
import type {
  Package,
  PackageBuilderPackageType,
  PackageBuilderSlotTemplate,
  Solution,
  SolutionTier,
  SolutionTierPricing,
  TaskRow,
} from "../../types";
import type { RoadmapPhase, RoadmapScenario } from "../../lib/roadmapModel";
import type { ProposalOfferingDates } from "../../lib/proposalDates";
import { ProposalOfferingDatesModal } from "./ProposalOfferingDatesModal";
import { ProposalAddedItemsPanel, type ProposalAddedLine } from "./ProposalAddedItemsPanel";
import type { ScenarioCopySource } from "./ProposalCopyScenarioOfferings";
import type { ModuleAddOnGroup } from "../../lib/buildCatalogDirectoryRows";
import {
  ProposalScenarioBudgetBars,
  type ScenarioBudgetBarRow,
} from "./ProposalScenarioBudgetBars";
import { proposalStepDef } from "./ProposalBuilderSteps";
import { ProposalPackageTemplatePicker } from "./ProposalPackageTemplatePicker";
import { ProposalCatalogTargetBar } from "./ProposalCatalogTargetBar";

type Props = {
  packageTypes: PackageBuilderPackageType[];
  slots: PackageBuilderSlotTemplate[];
  packages: Package[];
  solutions: Solution[];
  tiers: SolutionTier[];
  tasks: TaskRow[];
  pricing: SolutionTierPricing[];
  scenarios: RoadmapScenario[];
  phases: RoadmapPhase[];
  targetScenarioId: string;
  targetPhaseId: string;
  onTargetScenarioChange: (id: string) => void;
  onTargetPhaseChange: (id: string) => void;
  targetScenarioTitle: string;
  targetPhaseTitle: string;
  proposalStartDate: string;
  proposalEndDate: string;
  onAddPackage: (p: Package, dates: ProposalOfferingDates) => void;
  canAdd: boolean;
  catalogReloading?: boolean;
  onReloadCatalog?: () => Promise<void>;
  budget: number | null;
  scenarioBudgetBars: ScenarioBudgetBarRow[];
  formatUsd: (n: number | null | undefined) => string;
  addedLines: ProposalAddedLine[];
  onRemoveAdded: (key: string) => void;
  onEditAdded?: (key: string) => void;
  onDuplicateAdded?: (key: string) => void;
  onAddAddOns?: (parentKey: string, tierIds: string[]) => void;
  addonGroups?: ModuleAddOnGroup[];
  copyFromScenarios?: ScenarioCopySource[];
  onCopyFromScenario?: (sourceScenarioId: string) => void;
};

export function ProposalConfigurablePackagesPanel({
  packageTypes,
  slots,
  packages,
  solutions,
  tiers,
  tasks,
  pricing,
  scenarios,
  phases,
  targetScenarioId,
  targetPhaseId,
  onTargetScenarioChange,
  onTargetPhaseChange,
  targetScenarioTitle,
  targetPhaseTitle,
  proposalStartDate,
  proposalEndDate,
  onAddPackage,
  canAdd,
  catalogReloading,
  onReloadCatalog,
  budget,
  scenarioBudgetBars,
  formatUsd,
  addedLines,
  onRemoveAdded,
  onEditAdded,
  onDuplicateAdded,
  onAddAddOns,
  addonGroups,
  copyFromScenarios,
  onCopyFromScenario,
}: Props) {
  const stepMeta = proposalStepDef("packages");
  const [datesModalPkg, setDatesModalPkg] = useState<Package | null>(null);

  const handlePackageBuilt = useCallback((pkg: Package) => setDatesModalPkg(pkg), []);

  const confirmOfferingDates = (dates: ProposalOfferingDates) => {
    if (!datesModalPkg || !canAdd) return;
    onAddPackage(datesModalPkg, dates);
    setDatesModalPkg(null);
  };

  return (
    <div className="proposal-step-panel proposal-catalog proposal-configurable-packages">
      <header className="proposal-step-panel__head">
        <p className="proposal-step-panel__eyebrow">Step {stepMeta.number} · Build new</p>
        <h2 className="proposal-step-panel__title">Build a New Package</h2>
        <p className="proposal-step-panel__lead">
          Choose a configurable template, build it in the wizard, then add it to the active scenario and
          phase.
        </p>
      </header>

      <ProposalCatalogTargetBar
        scenarios={scenarios}
        phases={phases}
        targetScenarioId={targetScenarioId}
        targetPhaseId={targetPhaseId}
        onTargetScenarioChange={onTargetScenarioChange}
        onTargetPhaseChange={onTargetPhaseChange}
        targetScenarioTitle={targetScenarioTitle}
        targetPhaseTitle={targetPhaseTitle}
        canAdd={canAdd}
      />

      <div className="proposal-catalog-dashboard">
        <ProposalScenarioBudgetBars budget={budget} scenarios={scenarioBudgetBars} formatUsd={formatUsd} />
        <ProposalAddedItemsPanel
          scenarioTitle={targetScenarioTitle}
          targetPhaseTitle={targetPhaseTitle}
          lines={addedLines}
          onRemove={onRemoveAdded}
          onEdit={onEditAdded}
          onDuplicate={onDuplicateAdded}
          copyFromScenarios={copyFromScenarios}
          onCopyFromScenario={onCopyFromScenario}
          addonGroups={addonGroups}
          onAddAddOns={onAddAddOns}
        />
      </div>

      <ProposalPackageTemplatePicker
        packageTypes={packageTypes}
        slots={slots}
        packages={packages}
        solutions={solutions}
        tiers={tiers}
        tasks={tasks}
        pricing={pricing}
        canBuild={canAdd}
        catalogReloading={catalogReloading}
        onReloadCatalog={onReloadCatalog}
        onPackageBuilt={handlePackageBuilt}
        hint={
          <>
            Build a custom package from a template · adding to <strong>{targetScenarioTitle}</strong> ·{" "}
            <strong>{targetPhaseTitle}</strong>
          </>
        }
      />

      <ProposalOfferingDatesModal
        open={datesModalPkg != null}
        title="Solution dates"
        subtitle="Set when this package runs in the proposal timeline."
        itemLabel={datesModalPkg?.package_name}
        proposalStartDate={proposalStartDate}
        proposalEndDate={proposalEndDate}
        onCancel={() => setDatesModalPkg(null)}
        onConfirm={confirmOfferingDates}
      />
    </div>
  );
}
