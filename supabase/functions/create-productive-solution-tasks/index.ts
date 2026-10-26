import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/**
 * Creates a Productive.io task list when a Solutions Directory request is approved.
 *
 * Secrets (Supabase Dashboard → Edge Functions → Secrets):
 *   PRODUCTIVE_API_TOKEN — Personal access token (never put this in Vite env)
 *
 * Optional overrides (defaults target Weidert’s WGI DNA project):
 *   PRODUCTIVE_ORG_ID
 *   PRODUCTIVE_PROJECT_ID
 *   PRODUCTIVE_FOLDER_ID
 *   PRODUCTIVE_WORKFLOW_STATUS_ID
 *   PRODUCTIVE_APP_SLUG
 *   PRODUCTIVE_ASSIGNEE_CHELSEA
 *   PRODUCTIVE_ASSIGNEE_LAURA
 *   PRODUCTIVE_ASSIGNEE_JO
 *   PRODUCTIVE_ASSIGNEE_NICOLE
 */

const PRODUCTIVE_API = "https://api.productive.io/api/v2";
const PRODUCTIVE_API_TOKEN = Deno.env.get("PRODUCTIVE_API_TOKEN")?.trim() ?? "";
const PRODUCTIVE_ORG_ID = Deno.env.get("PRODUCTIVE_ORG_ID")?.trim() || "47945";
const PRODUCTIVE_PROJECT_ID = Number(Deno.env.get("PRODUCTIVE_PROJECT_ID")?.trim() || "825703");
const PRODUCTIVE_FOLDER_ID = Number(Deno.env.get("PRODUCTIVE_FOLDER_ID")?.trim() || "1004078");
const PRODUCTIVE_WORKFLOW_STATUS_ID = Number(
  Deno.env.get("PRODUCTIVE_WORKFLOW_STATUS_ID")?.trim() || "160919",
);
const PRODUCTIVE_APP_SLUG = Deno.env.get("PRODUCTIVE_APP_SLUG")?.trim() || "weidert-group";

const ASSIGNEE = {
  chelsea: Number(Deno.env.get("PRODUCTIVE_ASSIGNEE_CHELSEA")?.trim() || "1072559"),
  laura: Number(Deno.env.get("PRODUCTIVE_ASSIGNEE_LAURA")?.trim() || "1007724"),
  jo: Number(Deno.env.get("PRODUCTIVE_ASSIGNEE_JO")?.trim() || "1008511"),
  nicole: Number(Deno.env.get("PRODUCTIVE_ASSIGNEE_NICOLE")?.trim() || "1008506"),
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")?.trim() ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type RequestSnapshot = {
  solutionName: string;
  requestedByName: string;
  requestedByEmail: string;
  clientNeed: string;
  typicalUseCase: string;
  desiredDeliverables: string;
  whyProductize: string;
  suggestedPhase: string;
  suggestedCategory: string;
  suggestedTactic: string;
  inScope: string;
  outOfScope: string;
  knownWork: string;
  relatedOfferings: string;
  additionalNotes: string;
  priority: string;
};

const STEPS: Array<{
  title: string;
  assigneeId: number;
  owner: string;
  summary: string;
}> = [
  {
    title: "Draft Solutions Overview",
    assigneeId: ASSIGNEE.chelsea,
    owner: "Chelsea",
    summary: "Create the Solutions Overview for this offering.",
  },
  {
    title: "Enter resourcing and workflow",
    assigneeId: ASSIGNEE.laura,
    owner: "Laura",
    summary: "Enter resourcing and task/workflow info, working with SMEs as needed.",
  },
  {
    title: "Review solution",
    assigneeId: ASSIGNEE.jo,
    owner: "Jo",
    summary: "Review the solution.",
  },
  {
    title: "Enter pricing multipliers",
    assigneeId: ASSIGNEE.nicole,
    owner: "Nicole",
    summary: "Review the offering and enter pricing multipliers.",
  },
  {
    title: "Final review and notify team",
    assigneeId: ASSIGNEE.chelsea,
    owner: "Chelsea",
    summary: "Final review, then inform the team of the new solution.",
  },
];

function json(status: number, body: object) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function paragraph(label: string, value: string): string {
  const v = value.trim();
  if (!v) return "";
  return `<p><strong>${esc(label)}:</strong> ${esc(v).replace(/\n/g, "<br>")}</p>`;
}

function snapshotFromUnknown(raw: unknown): RequestSnapshot {
  const r = asRecord(raw);
  return {
    solutionName: str(r.solutionName) || str(r.solution_name) || "Untitled solution",
    requestedByName: str(r.requestedByName) || str(r.requested_by_name),
    requestedByEmail: str(r.requestedByEmail) || str(r.requested_by_email),
    clientNeed: str(r.clientNeed) || str(r.client_need),
    typicalUseCase: str(r.typicalUseCase) || str(r.typical_use_case),
    desiredDeliverables: str(r.desiredDeliverables) || str(r.desired_deliverables),
    whyProductize: str(r.whyProductize) || str(r.why_productize),
    suggestedPhase: str(r.suggestedPhase) || str(r.suggested_phase),
    suggestedCategory: str(r.suggestedCategory) || str(r.suggested_category),
    suggestedTactic: str(r.suggestedTactic) || str(r.suggested_tactic),
    inScope: str(r.inScope) || str(r.in_scope),
    outOfScope: str(r.outOfScope) || str(r.out_of_scope),
    knownWork: str(r.knownWork) || str(r.known_work),
    relatedOfferings: str(r.relatedOfferings) || str(r.related_offerings),
    additionalNotes: str(r.additionalNotes) || str(r.additional_notes),
    priority: str(r.priority) || "medium",
  };
}

function listUrl(taskListId: string): string {
  return `https://app.productive.io/${PRODUCTIVE_APP_SLUG}/projects/${PRODUCTIVE_PROJECT_ID}/task-lists/${taskListId}`;
}

function taskDescription(step: (typeof STEPS)[number], snap: RequestSnapshot, appUrl: string): string {
  const placement = [snap.suggestedPhase, snap.suggestedCategory, snap.suggestedTactic]
    .filter(Boolean)
    .join(" · ");
  const openLink = appUrl ? `${appUrl.replace(/\/$/, "")}/solution-requests` : "";
  return [
    `<p><strong>${esc(step.owner)}</strong> — ${esc(step.summary)}</p>`,
    paragraph("Solution", snap.solutionName),
    paragraph("Requested by", [snap.requestedByName, snap.requestedByEmail].filter(Boolean).join(" · ")),
    paragraph("Priority", snap.priority),
    paragraph("Client / business need", snap.clientNeed),
    paragraph("Typical use case", snap.typicalUseCase),
    paragraph("Desired deliverables", snap.desiredDeliverables),
    paragraph("Why productize", snap.whyProductize),
    paragraph("Suggested placement", placement),
    paragraph("In scope", snap.inScope),
    paragraph("Out of scope", snap.outOfScope),
    paragraph("Known work", snap.knownWork),
    paragraph("Related offerings", snap.relatedOfferings),
    paragraph("Additional notes", snap.additionalNotes),
    openLink ? `<p><a href="${esc(openLink)}">Open in Solutions Directory</a></p>` : "",
  ]
    .filter(Boolean)
    .join("");
}

async function productive(method: string, path: string, body?: unknown) {
  const res = await fetch(`${PRODUCTIVE_API}${path}`, {
    method,
    headers: {
      "X-Auth-Token": PRODUCTIVE_API_TOKEN,
      "X-Organization-Id": PRODUCTIVE_ORG_ID,
      "Content-Type": "application/vnd.api+json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await res.text();
  let parsed: unknown = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = raw;
  }
  if (!res.ok) {
    const errors = asRecord(parsed).errors;
    const first = Array.isArray(errors) ? asRecord(errors[0]) : {};
    const detail =
      str(first.detail) || str(first.title) || (typeof parsed === "string" ? parsed.slice(0, 400) : `HTTP ${res.status}`);
    throw new Error(detail || `Productive ${method} ${path} failed (${res.status})`);
  }
  return asRecord(parsed);
}

async function loadRequest(requestId: string): Promise<Record<string, unknown> | null> {
  if (!SUPABASE_URL || !SERVICE_ROLE || !requestId) return null;
  const url = `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/solution_requests?id=eq.${encodeURIComponent(requestId)}&select=*`;
  const res = await fetch(url, {
    headers: {
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
    },
  });
  if (!res.ok) return null;
  const rows = (await res.json()) as unknown;
  return Array.isArray(rows) && rows[0] ? asRecord(rows[0]) : null;
}

async function persistTaskList(requestId: string, taskListId: string, url: string) {
  if (!SUPABASE_URL || !SERVICE_ROLE || !requestId) return;
  const endpoint = `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/solution_requests?id=eq.${encodeURIComponent(requestId)}`;
  await fetch(endpoint, {
    method: "PATCH",
    headers: {
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      productive_task_list_id: taskListId,
      productive_task_list_url: url,
    }),
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  if (!PRODUCTIVE_API_TOKEN) {
    return json(500, {
      error:
        "PRODUCTIVE_API_TOKEN is not set. Add it under Supabase → Edge Functions → Secrets, then retry.",
    });
  }

  let body: Record<string, unknown>;
  try {
    body = asRecord(await req.json());
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const requestId = str(body.requestId);
  const appUrl = str(body.appUrl);
  const existingFromClient = str(body.existingTaskListId) || str(body.productiveTaskListId);

  const dbRow = requestId ? await loadRequest(requestId) : null;
  const existingId =
    existingFromClient || str(dbRow?.productive_task_list_id);
  const existingUrl = str(dbRow?.productive_task_list_url);

  if (existingId) {
    const url = existingUrl || listUrl(existingId);
    return json(200, {
      ok: true,
      skipped: true,
      taskListId: existingId,
      url,
    });
  }

  const snap = snapshotFromUnknown({ ...dbRow, ...asRecord(body.request) });
  const listName = snap.solutionName.slice(0, 120);

  try {
    const createdList = await productive("POST", "/task_lists", {
      data: {
        type: "task_lists",
        attributes: {
          name: listName,
          project_id: PRODUCTIVE_PROJECT_ID,
          folder_id: PRODUCTIVE_FOLDER_ID,
        },
      },
    });
    const listData = asRecord(createdList.data);
    const taskListId = str(listData.id);
    if (!taskListId) throw new Error("Productive did not return a task list id.");

    const taskIds: string[] = [];
    const taskErrors: string[] = [];
    for (let i = 0; i < STEPS.length; i++) {
      const step = STEPS[i];
      try {
        const createdTask = await productive("POST", "/tasks", {
          data: {
            type: "tasks",
            attributes: {
              title: step.title,
              description: taskDescription(step, snap, appUrl),
              project_id: PRODUCTIVE_PROJECT_ID,
              task_list_id: Number(taskListId),
              workflow_status_id: PRODUCTIVE_WORKFLOW_STATUS_ID,
              assignee_id: step.assigneeId,
              placement: i + 1,
            },
          },
        });
        const id = str(asRecord(createdTask.data).id);
        if (id) taskIds.push(id);
      } catch (err) {
        taskErrors.push(`${step.title}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const url = listUrl(taskListId);
    await persistTaskList(requestId, taskListId, url);

    return json(200, {
      ok: true,
      skipped: false,
      taskListId,
      url,
      taskIds,
      taskErrors: taskErrors.length ? taskErrors : undefined,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json(502, { error: msg });
  }
});
