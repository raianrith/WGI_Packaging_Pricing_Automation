import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/**
 * Creates a Productive.io task list when a Solutions Directory request is approved.
 *
 * Secrets (Supabase Dashboard → Edge Functions → Secrets):
 *   PRODUCTIVE_API_TOKEN — Personal access token (never put this in Vite env)
 *   SLACK_WEBHOOK_URL — same Incoming Webhook as notify-solution-request
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
 *   SLACK_USER_ID_CHELSEA — Slack member ID for a real @mention (e.g. U0123ABC)
 *   SLACK_USER_ID_NICOLE
 */

const PRODUCTIVE_API = "https://api.productive.io/api/v2";
const PRODUCTIVE_API_TOKEN = Deno.env.get("PRODUCTIVE_API_TOKEN")?.trim() ?? "";
const PRODUCTIVE_ORG_ID = Deno.env.get("PRODUCTIVE_ORG_ID")?.trim() || "47945";
const PRODUCTIVE_PROJECT_ID = Number(Deno.env.get("PRODUCTIVE_PROJECT_ID")?.trim() || "1099649");
const PRODUCTIVE_FOLDER_ID = Number(Deno.env.get("PRODUCTIVE_FOLDER_ID")?.trim() || "0");
const PRODUCTIVE_WORKFLOW_STATUS_ID = Number(
  Deno.env.get("PRODUCTIVE_WORKFLOW_STATUS_ID")?.trim() || "160919",
);
const PRODUCTIVE_APP_SLUG = Deno.env.get("PRODUCTIVE_APP_SLUG")?.trim() || "47945-weidert-group";
const SLACK_WEBHOOK_URL = Deno.env.get("SLACK_WEBHOOK_URL")?.trim() ?? "";
const SLACK_USER_ID_CHELSEA =
  Deno.env.get("SLACK_USER_ID_CHELSEA")?.trim() || "U019MGFFC31";
const SLACK_USER_ID_NICOLE =
  Deno.env.get("SLACK_USER_ID_NICOLE")?.trim() || "U03RL79N8";
const CHELSEA_EMAIL = "cdrusch@weidert.com";
const NICOLE_EMAIL = "nmertes@weidert.com";

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
    solutionName: str(r.solutionName) || str(r.solution_name) || str(r.title) || "Untitled solution",
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

function projectTasksUrl(): string {
  return `https://app.productive.io/${PRODUCTIVE_APP_SLUG}/projects/${PRODUCTIVE_PROJECT_ID}/tasks`;
}

function taskUrl(taskId: string): string {
  return `https://app.productive.io/${PRODUCTIVE_APP_SLUG}/tasks/${taskId}`;
}

/** Productive opens task lists via the project Tasks tab + base64 filter (not /task-lists/:id). */
function listUrl(taskListId: string): string {
  const filter = btoa(String(taskListId).trim());
  return `${projectTasksUrl()}?filter=${encodeURIComponent(filter)}`;
}

type TaskListSource = "solution_request" | "app_feedback";

function sourceTable(source: TaskListSource): "solution_requests" | "app_feedback" {
  return source === "app_feedback" ? "app_feedback" : "solution_requests";
}

function taskDescription(
  step: (typeof STEPS)[number],
  snap: RequestSnapshot,
  appUrl: string,
  source: TaskListSource,
): string {
  const placement = [snap.suggestedPhase, snap.suggestedCategory, snap.suggestedTactic]
    .filter(Boolean)
    .join(" · ");
  const path = source === "app_feedback" ? "/feedback" : "/solution-requests";
  const openLink = appUrl ? `${appUrl.replace(/\/$/, "")}${path}` : "";
  const openLabel = source === "app_feedback" ? "Open in Feedback" : "Open in Solutions Directory";
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
    openLink ? `<p><a href="${esc(openLink)}">${esc(openLabel)}</a></p>` : "",
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
    const list = Array.isArray(errors) ? errors.map((e) => asRecord(e)) : [];
    const parts = list.map((first) => {
      const detail =
        str(first.detail) || str(first.title) || (typeof parsed === "string" ? parsed.slice(0, 400) : `HTTP ${res.status}`);
      const pointer = str(asRecord(first.source).pointer);
      const attr = pointer
        .replace(/^\/?data\/attributes\//, "")
        .replace(/^\/?data\/relationships\//, "");
      return attr ? `${detail} (${attr})` : detail;
    }).filter(Boolean);
    throw new Error(
      parts.join("; ") ||
        (typeof parsed === "string" ? parsed.slice(0, 400) : `Productive ${method} ${path} failed (${res.status})`),
    );
  }
  return asRecord(parsed);
}

function idsFromListPayload(payload: Record<string, unknown>): number[] {
  const rows = Array.isArray(payload.data) ? payload.data : [];
  return rows
    .map((row) => Number(str(asRecord(row).id)))
    .filter((id) => Number.isFinite(id) && id > 0);
}

/** Boards and folders are the same Productive objects (UI calls them folders). */
async function listBoardIds(projectId: number): Promise<number[]> {
  const seen = new Set<number>();
  const add = (ids: number[]) => {
    for (const id of ids) seen.add(id);
  };
  try {
    const boards = await productive(
      "GET",
      `/boards?filter[project_id]=${projectId}&filter[status]=1&page[size]=50`,
    );
    add(idsFromListPayload(boards));
  } catch (err) {
    console.warn(
      "[create-productive-solution-tasks] board lookup failed",
      err instanceof Error ? err.message : String(err),
    );
  }
  if (seen.size === 0) {
    try {
      const folders = await productive(
        "GET",
        `/folders?filter[project_id]=${projectId}&filter[status]=1&page[size]=50`,
      );
      add(idsFromListPayload(folders));
    } catch (err) {
      console.warn(
        "[create-productive-solution-tasks] folder lookup failed",
        err instanceof Error ? err.message : String(err),
      );
    }
  }
  return [...seen];
}

async function ensureBoardIds(projectId: number): Promise<number[]> {
  const preferred = PRODUCTIVE_FOLDER_ID > 0 ? PRODUCTIVE_FOLDER_ID : 0;
  const existing = await listBoardIds(projectId);
  const ordered = [
    ...(preferred && existing.includes(preferred) ? [preferred] : []),
    ...existing.filter((id) => id !== preferred),
  ];
  if (ordered.length) return ordered;

  // Prefer /boards create; fall back to /folders (alias).
  let createdId = 0;
  try {
    const created = await productive("POST", "/boards", {
      data: {
        type: "boards",
        attributes: { name: "Solutions Directory" },
        relationships: {
          project: { data: { type: "projects", id: String(projectId) } },
        },
      },
    });
    createdId = Number(str(asRecord(created.data).id));
  } catch (boardErr) {
    console.warn(
      "[create-productive-solution-tasks] board create failed, trying folders",
      boardErr instanceof Error ? boardErr.message : String(boardErr),
    );
    const created = await productive("POST", "/folders", {
      data: {
        type: "folders",
        attributes: {
          name: "Solutions Directory",
          project_id: projectId,
        },
      },
    });
    createdId = Number(str(asRecord(created.data).id));
  }
  if (!Number.isFinite(createdId) || createdId <= 0) {
    throw new Error(`Could not create a Productive board/folder in project ${projectId}.`);
  }
  return [createdId];
}

/** Productive accepts board via relationships (preferred) or board_id/folder_id attributes. */
async function createTaskList(listName: string, projectId: number, boardId: number) {
  try {
    return await productive("POST", "/task_lists", {
      data: {
        type: "task_lists",
        attributes: { name: listName },
        relationships: {
          project: { data: { type: "projects", id: String(projectId) } },
          board: { data: { type: "boards", id: String(boardId) } },
        },
      },
    });
  } catch (relErr) {
    // Fallback for tenants that still expect attribute-style ids.
    try {
      return await productive("POST", "/task_lists", {
        data: {
          type: "task_lists",
          attributes: {
            name: listName,
            project_id: projectId,
            board_id: boardId,
          },
        },
      });
    } catch {
      return await productive("POST", "/task_lists", {
        data: {
          type: "task_lists",
          attributes: {
            name: listName,
            project_id: projectId,
            folder_id: boardId,
          },
        },
      }).catch(() => {
        throw relErr;
      });
    }
  }
}

async function loadRequest(
  requestId: string,
  source: TaskListSource,
): Promise<Record<string, unknown> | null> {
  if (!SUPABASE_URL || !SERVICE_ROLE || !requestId) return null;
  const table = sourceTable(source);
  const url = `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/${table}?id=eq.${encodeURIComponent(requestId)}&select=*`;
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

async function persistTaskList(
  requestId: string,
  source: TaskListSource,
  taskListId: string,
  url: string,
) {
  if (!SUPABASE_URL || !SERVICE_ROLE || !requestId) return;
  const table = sourceTable(source);
  const endpoint = `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/${table}?id=eq.${encodeURIComponent(requestId)}`;
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

function slackMention(userId: string, fallbackLabel: string): string {
  const id = userId.trim();
  if (id) return `<@${id.replace(/^<@/, "").replace(/>$/, "")}>`;
  return fallbackLabel;
}

/** Same Slack channel as new solution requests (SLACK_WEBHOOK_URL). Best-effort. */
async function notifySlackTaskListCreated(args: {
  snap: RequestSnapshot;
  requestId: string;
  source: TaskListSource;
  taskListUrl: string;
  firstTaskUrl?: string;
  appUrl: string;
  taskCount: number;
  taskErrors?: string[];
}): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  if (!SLACK_WEBHOOK_URL || !SLACK_WEBHOOK_URL.startsWith("https://hooks.slack.com/")) {
    return { ok: false, skipped: true, error: "SLACK_WEBHOOK_URL is not set" };
  }

  const chelsea = slackMention(SLACK_USER_ID_CHELSEA, `Chelsea (${CHELSEA_EMAIL})`);
  const nicole = slackMention(SLACK_USER_ID_NICOLE, `Nicole (${NICOLE_EMAIL})`);
  const feedbackPath = args.source === "app_feedback" ? "/feedback" : "/solution-requests";
  const openApp = args.appUrl ? `${args.appUrl.replace(/\/$/, "")}${feedbackPath}` : "";
  const requester = [args.snap.requestedByName, args.snap.requestedByEmail].filter(Boolean).join(" · ");

  const lines = [
    `${chelsea} ${nicole} — a Productive task list was created for this new solution request.`,
    `*Solution:* ${args.snap.solutionName}`,
    requester ? `*Requested by:* ${requester}` : "",
    `*Priority:* ${args.snap.priority || "medium"}`,
    args.requestId ? `*Request ID:* \`${args.requestId}\`` : "",
    `*<${args.taskListUrl}|Open Productive task list>*`,
    args.firstTaskUrl ? `*<${args.firstTaskUrl}|Open first task>*` : "",
    openApp
      ? `*<${openApp}|Open in ${args.source === "app_feedback" ? "Feedback" : "Solution Requests"}>*`
      : "",
    args.taskCount ? `*Tasks created:* ${args.taskCount}` : "",
  ].filter(Boolean);

  try {
    const slackRes = await fetch(SLACK_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `Productive tasks ready: ${args.snap.solutionName} — ${chelsea} ${nicole}`,
        blocks: [
          {
            type: "header",
            text: {
              type: "plain_text",
              text: "Productive task list created",
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
          ...(args.taskErrors?.length
            ? [
                {
                  type: "section",
                  text: {
                    type: "mrkdwn",
                    text: `*Some tasks failed:*\n${args.taskErrors.slice(0, 5).join("\n")}`,
                  },
                },
              ]
            : []),
        ],
      }),
    });
    if (!slackRes.ok) {
      const errText = await slackRes.text().catch(() => "");
      return { ok: false, error: `Slack webhook failed (${slackRes.status}): ${errText.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
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
  const source: TaskListSource =
    str(body.source) === "app_feedback" ? "app_feedback" : "solution_request";
  const existingFromClient = str(body.existingTaskListId) || str(body.productiveTaskListId);

  const dbRow = requestId ? await loadRequest(requestId, source) : null;
  const existingId =
    existingFromClient || str(dbRow?.productive_task_list_id);
  const existingUrl = str(dbRow?.productive_task_list_url);

  if (existingId) {
    // Always rebuild — older links used /task-lists/:id which Productive does not route.
    const url = listUrl(existingId);
    if (requestId && url !== existingUrl) {
      await persistTaskList(requestId, source, existingId, url);
    }
    return json(200, {
      ok: true,
      skipped: true,
      taskListId: existingId,
      url,
    });
  }

  const snap = snapshotFromUnknown({ ...dbRow, ...asRecord(body.request) });
  const listName = (snap.solutionName || str(dbRow?.title) || "Untitled solution").slice(0, 120);

  try {
    const boardCandidates = await ensureBoardIds(PRODUCTIVE_PROJECT_ID);
    let createdList: Record<string, unknown> | null = null;
    let folderId = 0;
    const folderErrors: string[] = [];
    for (const candidate of boardCandidates) {
      try {
        createdList = await createTaskList(listName, PRODUCTIVE_PROJECT_ID, candidate);
        folderId = candidate;
        break;
      } catch (err) {
        folderErrors.push(
          `board ${candidate}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    if (!createdList) {
      throw new Error(
        [
          `Could not create a Productive task list in project ${PRODUCTIVE_PROJECT_ID}.`,
          `Tried boards: ${boardCandidates.join(", ") || "(none)"}.`,
          ...folderErrors.slice(0, 3),
        ].join(" "),
      );
    }
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
              description: taskDescription(step, snap, appUrl, source),
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
    const firstTaskUrl = taskIds[0] ? taskUrl(taskIds[0]) : "";
    await persistTaskList(requestId, source, taskListId, url);

    const slack = await notifySlackTaskListCreated({
      snap,
      requestId,
      source,
      taskListUrl: url,
      firstTaskUrl: firstTaskUrl || undefined,
      appUrl,
      taskCount: taskIds.length,
      taskErrors: taskErrors.length ? taskErrors : undefined,
    });
    if (!slack.ok && !slack.skipped) {
      console.warn("[create-productive-solution-tasks] slack notify failed", slack.error);
    }

    return json(200, {
      ok: true,
      skipped: false,
      taskListId,
      url,
      folderId,
      taskIds,
      taskErrors: taskErrors.length ? taskErrors : undefined,
      slackNotified: Boolean(slack.ok),
      slackError: slack.ok || slack.skipped ? undefined : slack.error,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json(502, { error: msg });
  }
});
