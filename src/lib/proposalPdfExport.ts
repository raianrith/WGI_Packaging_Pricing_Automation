import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { RoadmapCard, RoadmapPhase, RoadmapScenario } from "./roadmapModel";
import {
  budgetVsScenarioStatus,
  cardHoursForScenarioRollup,
  cardPriceUsdForRollup,
  effectivePriceStr,
  sortedPhasesForScenario,
  type CatalogCtxLike,
} from "./roadmapModel";
import {
  resolveProposalCardTasks,
  sumProposalTaskHours,
  type ProposalCardTasksCtx,
  type ProposalEditableTask,
} from "./proposalCardTasks";
import { proposalDateRangeLabel } from "./proposalDates";
import { PROPOSAL_DURATION_LABEL } from "../branding";
import { formatProposalDurationLabel } from "./roadmapProposalSnapshot";

const BRAND_RGB: [number, number, number] = [13, 92, 77];
const MARGIN_X = 14;
const PAGE_W = 210;
const CONTENT_W = PAGE_W - MARGIN_X * 2;

export type ProposalPdfExportInput = {
  roadmapTitle: string;
  clientLabel: string;
  horizonMonths: number | "custom";
  proposalStartDate: string;
  proposalEndDate: string;
  clientBudgetRaw: string;
  budgetNumber: number | null;
  scenarios: RoadmapScenario[];
  phases: RoadmapPhase[];
  cards: RoadmapCard[];
  ctx: CatalogCtxLike;
  computeScratchSellPrice: (c: RoadmapCard, ctx: CatalogCtxLike | null) => string;
  formatHoursShort: (n: number) => string;
};

export type ProposalOpsPdfExportInput = ProposalPdfExportInput & {
  tasksCtx: ProposalCardTasksCtx;
};

function formatUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number(n));
}

function safeFilenamePart(s: string): string {
  const cleaned = s
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 72);
  return cleaned || "proposal";
}

function getFinalY(doc: jsPDF): number {
  const ext = doc as jsPDF & { lastAutoTable?: { finalY: number } };
  return ext.lastAutoTable?.finalY ?? 0;
}

function ensureSpace(doc: jsPDF, y: number, needed: number): number {
  const pageH = doc.internal.pageSize.getHeight();
  if (y + needed > pageH - 16) {
    doc.addPage();
    return 18;
  }
  return y;
}

function addWrappedText(doc: jsPDF, text: string, x: number, y: number, maxWidth: number, lineHeight = 4.2): number {
  const lines = doc.splitTextToSize(text, maxWidth) as string[];
  for (const line of lines) {
    y = ensureSpace(doc, y, lineHeight + 1);
    doc.text(line, x, y);
    y += lineHeight;
  }
  return y;
}

function renderLineItemsTable(
  doc: jsPDF,
  startY: number,
  cards: RoadmapCard[],
  ctx: CatalogCtxLike,
  computeScratchSellPrice: (c: RoadmapCard, ctx: CatalogCtxLike | null) => string
): number {
  if (cards.length === 0) return startY;

  const body = cards.map((c) => {
    const deliverable = sanitizePdfText(c.headline.trim() || "(untitled)") || "(untitled)";
    return [
      deliverable,
      proposalDateRangeLabel(c.startDate, c.endDate),
      effectivePriceStr(c, ctx, computeScratchSellPrice) || "—",
    ];
  });

  autoTable(doc, {
    startY,
    margin: { left: MARGIN_X, right: MARGIN_X },
    head: [["Deliverable", "Dates", "Price"]],
    body,
    styles: { fontSize: 8.5, cellPadding: 2.5, overflow: "linebreak", valign: "top" },
    headStyles: {
      fillColor: BRAND_RGB,
      textColor: 255,
      fontStyle: "bold",
      fontSize: 8.5,
    },
    alternateRowStyles: { fillColor: [248, 246, 242] },
    columnStyles: {
      0: { cellWidth: CONTENT_W - 58 },
      1: { cellWidth: 36 },
      2: { cellWidth: 22, halign: "right" },
    },
  });

  return getFinalY(doc) + 6;
}

function renderPhaseBlock(
  doc: jsPDF,
  y: number,
  phaseTitle: string,
  phaseSub: string,
  cards: RoadmapCard[],
  ctx: CatalogCtxLike,
  computeScratchSellPrice: (c: RoadmapCard, ctx: CatalogCtxLike | null) => string
): number {
  y = ensureSpace(doc, y, 14);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(40, 40, 40);
  doc.text(phaseTitle, MARGIN_X, y);
  if (phaseSub) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(100, 100, 100);
    doc.text(phaseSub, MARGIN_X, y + 4.5);
    y += 5;
  }
  y += 6;
  doc.setTextColor(0, 0, 0);
  return renderLineItemsTable(doc, y, cards, ctx, computeScratchSellPrice);
}

/** Build and trigger download of a client-ready proposal PDF. */
export function downloadProposalPdf(input: ProposalPdfExportInput): void {
  const {
    roadmapTitle,
    clientLabel,
    horizonMonths,
    proposalStartDate,
    proposalEndDate,
    clientBudgetRaw,
    budgetNumber,
    scenarios,
    phases,
    cards,
    ctx,
    computeScratchSellPrice,
    formatHoursShort,
  } = input;

  const doc = new jsPDF({ unit: "mm", format: "letter", orientation: "portrait" });
  let y = 18;

  const title = roadmapTitle.trim() || "Proposal";
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(BRAND_RGB[0], BRAND_RGB[1], BRAND_RGB[2]);
  y = addWrappedText(doc, title, MARGIN_X, y, CONTENT_W, 7);
  y += 2;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(60, 60, 60);
  const meta: string[] = [];
  if (clientLabel.trim()) meta.push(`Client: ${clientLabel.trim()}`);
  meta.push(
    `${PROPOSAL_DURATION_LABEL}: ${formatProposalDurationLabel(String(horizonMonths === "custom" ? "custom" : horizonMonths))}`
  );
  const scheduleLabel = proposalDateRangeLabel(proposalStartDate, proposalEndDate);
  if (scheduleLabel !== "—") meta.push(`Proposal dates: ${scheduleLabel}`);
  if (budgetNumber != null) meta.push(`Budget: ${formatUsd(budgetNumber)}`);
  else if (clientBudgetRaw.trim()) meta.push(`Budget: ${clientBudgetRaw.trim()}`);
  meta.push(`Generated: ${new Date().toLocaleDateString(undefined, { dateStyle: "medium" })}`);
  for (const line of meta) {
    y = addWrappedText(doc, line, MARGIN_X, y, CONTENT_W);
  }
  y += 4;

  doc.setDrawColor(BRAND_RGB[0], BRAND_RGB[1], BRAND_RGB[2]);
  doc.setLineWidth(0.4);
  doc.line(MARGIN_X, y, PAGE_W - MARGIN_X, y);
  y += 8;

  if (cards.length === 0) {
    doc.setFontSize(10);
    doc.setTextColor(80, 80, 80);
    y = addWrappedText(doc, "No line items have been added to this proposal yet.", MARGIN_X, y, CONTENT_W);
  }

  for (const scenario of scenarios) {
    const scenCards = cards.filter((c) => c.scenarioId === scenario.id);
    y = ensureSpace(doc, y, 20);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(BRAND_RGB[0], BRAND_RGB[1], BRAND_RGB[2]);
    doc.text(scenario.title.trim() || "Scenario", MARGIN_X, y);
    y += 7;

    if (scenario.narrative.trim()) {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(9);
      doc.setTextColor(70, 70, 70);
      y = addWrappedText(doc, scenario.narrative.trim(), MARGIN_X, y, CONTENT_W);
      y += 3;
    }

    let includedGrand = 0;
    for (const c of scenCards) {
      if (c.scope !== "included") continue;
      const p = cardPriceUsdForRollup(c, ctx, computeScratchSellPrice);
      if (p != null) includedGrand += p;
    }

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(50, 50, 50);
    let subLine = `Included scope subtotal: ${formatUsd(includedGrand)}`;
    if (budgetNumber != null) {
      const st = budgetVsScenarioStatus(includedGrand, budgetNumber);
      const rem = budgetNumber - includedGrand;
      const budgetNote =
        st === "over"
          ? `${formatUsd(Math.abs(rem))} over budget`
          : st === "in_range"
            ? "Within budget range"
            : `${formatUsd(Math.max(0, rem))} under budget`;
      subLine += ` · ${budgetNote}`;
    }
    y = addWrappedText(doc, subLine, MARGIN_X, y, CONTENT_W);
    y += 4;

    if (scenCards.length === 0) {
      y = addWrappedText(doc, "Nothing added in this scenario.", MARGIN_X, y, CONTENT_W);
      y += 6;
      continue;
    }

    const phaseOrder = sortedPhasesForScenario(phases, scenario.id);
    for (const phase of phaseOrder) {
      const rows = scenCards.filter((c) => c.phaseId === phase.id && c.scope === "included");
      if (rows.length === 0) continue;

      let ps = 0;
      let ph = 0;
      let phn = 0;
      for (const c of rows) {
        const pu = cardPriceUsdForRollup(c, ctx, computeScratchSellPrice);
        if (pu != null) ps += pu;
        const hh = cardHoursForScenarioRollup(c, ctx);
        if (hh != null) {
          ph += hh;
          phn += 1;
        }
      }
      const phaseSub = `${formatUsd(ps)}${phn > 0 ? ` · ~${formatHoursShort(ph)} h` : ""}`;
      y = renderPhaseBlock(
        doc,
        y,
        phase.title.trim() || "Phase",
        phaseSub,
        rows,
        ctx,
        computeScratchSellPrice
      );
    }

    const optional = scenCards.filter((c) => c.scope === "optional");
    if (optional.length > 0) {
      y = renderPhaseBlock(doc, y, "Optional add-ons", "Not included in core subtotal", optional, ctx, computeScratchSellPrice);
    }

    const deferred = scenCards.filter((c) => c.scope === "deferred");
    if (deferred.length > 0) {
      y = renderPhaseBlock(doc, y, "Deferred (not in core)", "", deferred, ctx, computeScratchSellPrice);
    }

    y += 4;
  }

  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(130, 130, 130);
    doc.text(`Page ${i} of ${pageCount}`, PAGE_W - MARGIN_X, doc.internal.pageSize.getHeight() - 8, { align: "right" });
  }

  const filename = `${safeFilenamePart(title)}-client.pdf`;
  doc.save(filename);
}

function formatTaskHours(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const rounded = Math.round(n * 100) / 100;
  return Number.isInteger(rounded) ? `${rounded} h` : `${rounded} h`;
}

/**
 * Helvetica (jsPDF default) cannot draw emoji / many symbols — they become
 * garbage like "&^p" or "& `þ" around vault task group titles (e.g. ☂️ … ☂️).
 */
function sanitizePdfText(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/[\uFE0E\uFE0F\u200D]/g, "")
    .replace(/[\u2600-\u27BF]/g, "")
    .replace(/[\uE000-\uF8FF]/g, "")
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s*&|·•\-–—]+|[\s*&|·•\-–—]+$/g, "")
    .trim();
}

/** Vault checklist often uses zero-detail rows as section labels between real tasks. */
function isOpsTaskSectionHeader(t: ProposalEditableTask): boolean {
  const hasImpl = !!(t.implementer ?? "").trim();
  const hasHours = t.hours != null && Number.isFinite(t.hours);
  if (hasImpl || hasHours) return false;
  const name = sanitizePdfText(t.name.trim() || t.catalogName || "");
  return name.length > 0;
}

function renderOpsDeliverableBlock(
  doc: jsPDF,
  y: number,
  card: RoadmapCard,
  tasks: ProposalEditableTask[],
  ctx: CatalogCtxLike,
  computeScratchSellPrice: (c: RoadmapCard, ctx: CatalogCtxLike | null) => string,
  formatHoursShort: (n: number) => string
): number {
  y = ensureSpace(doc, y, 18);
  const title = sanitizePdfText(card.headline.trim() || "(untitled)") || "(untitled)";
  const price = effectivePriceStr(card, ctx, computeScratchSellPrice) || "—";
  const dates = proposalDateRangeLabel(card.startDate, card.endDate);
  const hoursSum = sumProposalTaskHours(tasks);
  const hoursLabel =
    hoursSum > 0
      ? `~${formatHoursShort(hoursSum)} h`
      : cardHoursForScenarioRollup(card, ctx) != null
        ? `~${formatHoursShort(cardHoursForScenarioRollup(card, ctx)!)} h`
        : "—";

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(30, 30, 30);
  y = addWrappedText(doc, title, MARGIN_X, y, CONTENT_W, 4.5);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(90, 90, 90);
  y = addWrappedText(
    doc,
    `${card.scope} · ${dates} · ${hoursLabel} · ${price}`,
    MARGIN_X,
    y,
    CONTENT_W,
    3.8
  );
  y += 2;

  if (tasks.length === 0) {
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    y = addWrappedText(doc, "No tasks on this deliverable.", MARGIN_X, y, CONTENT_W, 3.8);
    y += 4;
    return y;
  }

  const headerFlags = tasks.map(isOpsTaskSectionHeader);
  const body = tasks.map((t, i) => {
    const label =
      sanitizePdfText(t.name.trim() || t.catalogName || "") || "(task)";
    if (headerFlags[i]) {
      return [{ content: label, colSpan: 3, styles: { fontStyle: "bold" as const, halign: "left" as const } }];
    }
    return [
      label,
      sanitizePdfText((t.implementer ?? "").trim()) || "—",
      formatTaskHours(t.hours),
    ];
  });

  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN_X, right: MARGIN_X },
    head: [["Task", "Implementer", "Hours"]],
    body,
    styles: { fontSize: 8, cellPadding: 2, overflow: "linebreak", valign: "top" },
    headStyles: {
      fillColor: [31, 77, 99],
      textColor: 255,
      fontStyle: "bold",
      fontSize: 8,
    },
    alternateRowStyles: { fillColor: [246, 248, 250] },
    columnStyles: {
      0: { cellWidth: CONTENT_W - 62 },
      1: { cellWidth: 40 },
      2: { cellWidth: 22, halign: "right" },
    },
    didParseCell: (data) => {
      if (data.section !== "body") return;
      if (!headerFlags[data.row.index]) return;
      data.cell.styles.fillColor = [232, 238, 241];
      data.cell.styles.textColor = [31, 77, 99];
      data.cell.styles.fontStyle = "bold";
    },
  });

  return getFinalY(doc) + 6;
}

/** Ops PDF: client tables plus task / implementer / hours breakdown per deliverable. */
export function downloadProposalOpsPdf(input: ProposalOpsPdfExportInput): void {
  const {
    roadmapTitle,
    clientLabel,
    horizonMonths,
    proposalStartDate,
    proposalEndDate,
    clientBudgetRaw,
    budgetNumber,
    scenarios,
    phases,
    cards,
    ctx,
    tasksCtx,
    computeScratchSellPrice,
    formatHoursShort,
  } = input;

  const doc = new jsPDF({ unit: "mm", format: "letter", orientation: "portrait" });
  let y = 18;

  const title = roadmapTitle.trim() || "Proposal";
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(BRAND_RGB[0], BRAND_RGB[1], BRAND_RGB[2]);
  y = addWrappedText(doc, `${title} — Ops`, MARGIN_X, y, CONTENT_W, 7);
  y += 2;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(60, 60, 60);
  const meta: string[] = ["Internal operations export · tasks, hours, and implementers"];
  if (clientLabel.trim()) meta.push(`Client: ${clientLabel.trim()}`);
  meta.push(
    `${PROPOSAL_DURATION_LABEL}: ${formatProposalDurationLabel(String(horizonMonths === "custom" ? "custom" : horizonMonths))}`
  );
  const scheduleLabel = proposalDateRangeLabel(proposalStartDate, proposalEndDate);
  if (scheduleLabel !== "—") meta.push(`Proposal dates: ${scheduleLabel}`);
  if (budgetNumber != null) meta.push(`Budget: ${formatUsd(budgetNumber)}`);
  else if (clientBudgetRaw.trim()) meta.push(`Budget: ${clientBudgetRaw.trim()}`);
  meta.push(`Generated: ${new Date().toLocaleDateString(undefined, { dateStyle: "medium" })}`);
  for (const line of meta) {
    y = addWrappedText(doc, line, MARGIN_X, y, CONTENT_W);
  }
  y += 4;

  doc.setDrawColor(BRAND_RGB[0], BRAND_RGB[1], BRAND_RGB[2]);
  doc.setLineWidth(0.4);
  doc.line(MARGIN_X, y, PAGE_W - MARGIN_X, y);
  y += 8;

  if (cards.length === 0) {
    doc.setFontSize(10);
    doc.setTextColor(80, 80, 80);
    y = addWrappedText(doc, "No line items have been added to this proposal yet.", MARGIN_X, y, CONTENT_W);
  }

  for (const scenario of scenarios) {
    const scenCards = cards.filter((c) => c.scenarioId === scenario.id);
    y = ensureSpace(doc, y, 20);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(BRAND_RGB[0], BRAND_RGB[1], BRAND_RGB[2]);
    doc.text(scenario.title.trim() || "Scenario", MARGIN_X, y);
    y += 7;

    if (scenario.narrative.trim()) {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(9);
      doc.setTextColor(70, 70, 70);
      y = addWrappedText(doc, scenario.narrative.trim(), MARGIN_X, y, CONTENT_W);
      y += 3;
    }

    let includedGrand = 0;
    for (const c of scenCards) {
      if (c.scope !== "included") continue;
      const p = cardPriceUsdForRollup(c, ctx, computeScratchSellPrice);
      if (p != null) includedGrand += p;
    }

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(50, 50, 50);
    y = addWrappedText(doc, `Included scope subtotal: ${formatUsd(includedGrand)}`, MARGIN_X, y, CONTENT_W);
    y += 4;

    if (scenCards.length === 0) {
      y = addWrappedText(doc, "Nothing added in this scenario.", MARGIN_X, y, CONTENT_W);
      y += 6;
      continue;
    }

    const phaseOrder = sortedPhasesForScenario(phases, scenario.id);
    const sections: Array<{ title: string; sub: string; rows: RoadmapCard[] }> = [];
    for (const phase of phaseOrder) {
      const rows = scenCards.filter((c) => c.phaseId === phase.id && c.scope === "included");
      if (rows.length === 0) continue;
      let ps = 0;
      let ph = 0;
      let phn = 0;
      for (const c of rows) {
        const pu = cardPriceUsdForRollup(c, ctx, computeScratchSellPrice);
        if (pu != null) ps += pu;
        const hh = cardHoursForScenarioRollup(c, ctx);
        if (hh != null) {
          ph += hh;
          phn += 1;
        }
      }
      sections.push({
        title: phase.title.trim() || "Phase",
        sub: `${formatUsd(ps)}${phn > 0 ? ` · ~${formatHoursShort(ph)} h` : ""}`,
        rows,
      });
    }
    const optional = scenCards.filter((c) => c.scope === "optional");
    if (optional.length > 0) {
      sections.push({ title: "Optional add-ons", sub: "Not included in core subtotal", rows: optional });
    }
    const deferred = scenCards.filter((c) => c.scope === "deferred");
    if (deferred.length > 0) {
      sections.push({ title: "Deferred (not in core)", sub: "", rows: deferred });
    }

    for (const section of sections) {
      y = ensureSpace(doc, y, 14);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(40, 40, 40);
      doc.text(section.title, MARGIN_X, y);
      if (section.sub) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8.5);
        doc.setTextColor(100, 100, 100);
        doc.text(section.sub, MARGIN_X, y + 4.5);
        y += 5;
      }
      y += 6;
      for (const card of section.rows) {
        const tasks = resolveProposalCardTasks(card, tasksCtx);
        y = renderOpsDeliverableBlock(
          doc,
          y,
          card,
          tasks,
          ctx,
          computeScratchSellPrice,
          formatHoursShort
        );
      }
    }

    y += 4;
  }

  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(130, 130, 130);
    doc.text(`Page ${i} of ${pageCount}`, PAGE_W - MARGIN_X, doc.internal.pageSize.getHeight() - 8, {
      align: "right",
    });
  }

  doc.save(`${safeFilenamePart(title)}-ops.pdf`);
}
