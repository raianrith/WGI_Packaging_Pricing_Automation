import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/**
 * Posts to Slack when someone requests a new Solutions Directory offering.
 *
 * Secrets (Supabase Dashboard → Edge Functions → Secrets):
 *   SLACK_WEBHOOK_URL — Incoming Webhook URL from Slack
 */

const SLACK_WEBHOOK_URL = Deno.env.get("SLACK_WEBHOOK_URL")?.trim() ?? "";
const CHELSEA_NOTIFY = "cdrusch@weidert.com";

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

function priorityLabel(priority: string): string {
  if (priority === "low") return "Low";
  if (priority === "high") return "High";
  return "Medium";
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

  const form = (body.form && typeof body.form === "object"
    ? body.form
    : {}) as Record<string, unknown>;
  const requestId = String(body.requestId ?? "").trim();
  const appUrl = String(body.appUrl ?? "").trim();
  const priority = String(body.priority ?? form.priority ?? "medium").trim();
  const openLink = appUrl ? appUrl.replace(/\/$/, "") + "/solution-requests" : "";

  const solutionName = String(form.solutionName ?? "").trim() || "Untitled solution";
  const requestedByName = String(form.requestedByName ?? "").trim() || "Unknown";
  const requestedByEmail = String(form.requestedByEmail ?? "").trim() || "Unknown";
  const clientNeed = String(form.clientNeed ?? "").trim();
  const typicalUseCase = String(form.typicalUseCase ?? "").trim();
  const desiredDeliverables = String(form.desiredDeliverables ?? "").trim();
  const whyProductize = String(form.whyProductize ?? "").trim();
  const suggestedPhase = String(form.suggestedPhase ?? "").trim();
  const suggestedCategory = String(form.suggestedCategory ?? "").trim();
  const suggestedTactic = String(form.suggestedTactic ?? "").trim();

  const lines = [
    `*Notify:* ${CHELSEA_NOTIFY}`,
    `*Solution:* ${solutionName}`,
    `*Requested by:* ${requestedByName} (${requestedByEmail})`,
    `*Priority:* ${priorityLabel(priority)}`,
  ];
  if (suggestedPhase || suggestedCategory || suggestedTactic) {
    lines.push(
      `*Suggested placement:* ${[suggestedPhase, suggestedCategory, suggestedTactic]
        .filter(Boolean)
        .join(" · ")}`
    );
  }
  if (requestId) lines.push(`*Request ID:* \`${requestId}\``);
  if (openLink) lines.push(`*<${openLink}|Open Solution Requests queue>*`);

  const blocks: object[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "New Solution Request",
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

  if (clientNeed) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Client / business need:*\n${truncate(clientNeed, 1200)}`,
      },
    });
  }
  if (typicalUseCase) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Typical use case:*\n${truncate(typicalUseCase, 900)}`,
      },
    });
  }
  if (desiredDeliverables) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Desired deliverables:*\n${truncate(desiredDeliverables, 900)}`,
      },
    });
  }
  if (whyProductize) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Why productize:*\n${truncate(whyProductize, 900)}`,
      },
    });
  }

  const slackRes = await fetch(SLACK_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: `New Solution Request: ${solutionName} (from ${requestedByEmail}) — notify ${CHELSEA_NOTIFY}`,
      blocks,
    }),
  });

  if (!slackRes.ok) {
    const errText = await slackRes.text().catch(() => "");
    return json(502, {
      error: `Slack webhook failed (${slackRes.status}): ${truncate(errText, 200)}`,
    });
  }

  return json(200, { ok: true, channel: "slack" });
});
