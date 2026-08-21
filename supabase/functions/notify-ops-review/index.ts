import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/**
 * Posts to Slack when a proposal is submitted for Ops Review.
 *
 * Secrets (Supabase Dashboard → Edge Functions → Secrets):
 *   SLACK_WEBHOOK_URL — Incoming Webhook URL from Slack
 *     (api.slack.com → Your Apps → Incoming Webhooks → Add to Channel)
 */

const SLACK_WEBHOOK_URL = Deno.env.get("SLACK_WEBHOOK_URL")?.trim() ?? "";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type NotifyBody = {
  proposalId?: string | null;
  clientLabel?: string | null;
  roadmapTitle?: string | null;
  submittedByEmail?: string | null;
  appUrl?: string | null;
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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

  let body: NotifyBody;
  try {
    body = (await req.json()) as NotifyBody;
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const clientLabel = (body.clientLabel ?? "").trim() || "Unknown client";
  const roadmapTitle = (body.roadmapTitle ?? "").trim() || "Untitled proposal";
  const submittedBy = (body.submittedByEmail ?? "").trim() || "Unknown submitter";
  const appUrl = (body.appUrl ?? "").trim();
  const proposalId = (body.proposalId ?? "").trim();
  const openLink = appUrl ? appUrl.replace(/\/$/, "") + "/roadmap" : "";

  const lines = [
    "*Client:* " + clientLabel,
    "*Roadmap:* " + roadmapTitle,
    "*Submitted by:* " + submittedBy,
  ];
  if (proposalId) {
    lines.push("*Proposal ID:* `" + proposalId + "`");
  }
  if (openLink) {
    lines.push("*<" + openLink + "|Open Proposal Builder - Awaiting Ops Review>*");
  }

  const payload = {
    text: "Proposal submitted for Ops Review: " + roadmapTitle + " (" + clientLabel + ")",
    blocks: [
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
    ],
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
