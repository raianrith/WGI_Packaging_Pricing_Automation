import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/**
 * Posts to Slack when a proposal is submitted for Ops Review.
 *
 * Secrets (Supabase Dashboard → Edge Functions → Secrets):
 *   SLACK_WEBHOOK_URL — Incoming Webhook URL from Slack
 *     (api.slack.com → Your Apps → Incoming Webhooks → Add to Channel)
 */

const SLACK_WEBHOOK_URL = Deno.env.get("SLACK_WEBHOOK_URL")?.trim() ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(status: number, body: object) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function truncate(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1).trimEnd() + "…";
}

function displayModeLabel(mode: string): string {
  if (mode === "section_totals") return "Section totals";
  if (mode === "proposal_total") return "One-line Proposal Total";
  return mode.trim() || "Not specified";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  if (!SLACK_WEBHOOK_URL || !SLACK_WEBHOOK_URL.startsWith("https://hooks.slack.com/")) {
    return json(500, {
      error:
        "SLACK_WEBHOOK_URL is not set. Create an Incoming Webhook in Slack, then add the URL under Supabase → Edge Functions → Secrets.",
    });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const clientLabel = String(body.clientLabel ?? "").trim() || "Unknown client";
  const roadmapTitle = String(body.roadmapTitle ?? "").trim() || "Untitled proposal";
  const submittedBy = String(body.submittedByEmail ?? "").trim() || "Unknown submitter";
  const appUrl = String(body.appUrl ?? "").trim();
  const proposalId = String(body.proposalId ?? "").trim();
  const openLink = appUrl ? appUrl.replace(/\/$/, "") + "/roadmap" : "";
  const ops = (body.opsReview && typeof body.opsReview === "object"
    ? body.opsReview
    : null) as Record<string, unknown> | null;

  const lines = [
    "*Client:* " + clientLabel,
    "*Roadmap:* " + roadmapTitle,
    "*Submitted by:* " + submittedBy,
  ];
  const projectOwner = ops ? String(ops.projectOwner ?? "").trim() : "";
  if (projectOwner) {
    lines.push("*Project owner:* " + projectOwner);
  }
  if (ops && typeof ops.wisconsinBasedClient === "boolean") {
    lines.push("*Wisconsin-based client:* " + (ops.wisconsinBasedClient ? "Yes" : "No"));
  }
  const displayMode = ops ? String(ops.displayMode ?? "").trim() : "";
  if (displayMode) {
    lines.push("*Client display:* " + displayModeLabel(displayMode));
  }
  if (proposalId) {
    lines.push("*Proposal ID:* `" + proposalId + "`");
  }
  if (openLink) {
    lines.push("*<" + openLink + "|Open Proposal Builder - Awaiting Ops Review>*");
  }

  const blocks: object[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "Proposal submitted for Ops Review",
        emoji: true,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: lines.join("\n"),
      },
    },
  ];

  const summary = ops ? String(ops.claudeChatSummary ?? "").trim() : "";
  if (summary) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "*Claude chat summary:*\n" + truncate(summary, 2800),
      },
    });
  }

  const sectionsRaw = ops && Array.isArray(ops.sections) ? ops.sections : [];
  if (displayMode === "section_totals" && sectionsRaw.length !== 0) {
    const sectionLines = sectionsRaw.map((raw, i) => {
      const s = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
      const name = String(s.name ?? "").trim() || `Section ${i + 1}`;
      const notes = String(s.notes ?? "").trim();
      return notes
        ? `*${i + 1}. ${name}*\n${truncate(notes, 500)}`
        : `*${i + 1}. ${name}*`;
    });
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "*Proposal sections:*\n" + truncate(sectionLines.join("\n\n"), 2800),
      },
    });
  }

  const customScoping =
    body.customScoping && typeof body.customScoping === "object"
      ? (body.customScoping as Record<string, unknown>)
      : null;
  const customRequests = customScoping && Array.isArray(customScoping.requests)
    ? customScoping.requests
    : [];
  if (customScoping?.required === true && customRequests.length > 0) {
    const requestLines = customRequests.map((raw, i) => {
      const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
      const name = String(r.name ?? "").trim() || `Request ${i + 1}`;
      const dtype = String(r.deliverableType ?? "").trim();
      const other = String(r.deliverableTypeOther ?? "").trim();
      const typeLabel = dtype === "Other" ? other || "Other" : dtype || "Unspecified";
      const overview = String(r.overviewAndGoal ?? "").trim();
      const deadline = String(r.deadline ?? "").trim();
      const budget = String(r.budget ?? "").trim();
      const bits = [`*${i + 1}. ${name}* (${typeLabel})`];
      if (overview) bits.push(truncate(overview, 400));
      if (budget) bits.push(`Budget: ${truncate(budget, 160)}`);
      if (deadline) bits.push(`Deadline: ${truncate(deadline, 160)}`);
      return bits.join("\n");
    });
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "*Custom scoping requests:*\n" + truncate(requestLines.join("\n\n"), 2800),
      },
    });
  }

  const payload = {
    text: "Proposal submitted for Ops Review: " + roadmapTitle + " (" + clientLabel + ")",
    blocks,
  };

  const res = await fetch(SLACK_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const responseText = await res.text();
  if (!res.ok || responseText !== "ok") {
    console.error("Slack webhook error", res.status, responseText);
    return json(502, {
      error: "Failed to post Slack notification",
      details: responseText,
      status: res.status,
    });
  }

  return json(200, { ok: true, channel: "slack" });
});
