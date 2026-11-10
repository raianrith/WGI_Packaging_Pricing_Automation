import type { FeedbackBoardRow } from "./appFeedback";
import { getSupabase } from "./supabase";
import type { SolutionRequest } from "./solutionRequests";

export type ProductiveTaskListResult = {
  ok: boolean;
  skipped?: boolean;
  taskListId?: string;
  url?: string;
  error?: string;
};

export type ProductiveTaskListSource = "solution_request" | "app_feedback";

type ProductiveRequestPayload = {
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

function requestPayloadFromSolutionRequest(row: SolutionRequest): ProductiveRequestPayload {
  return {
    solutionName: row.solution_name,
    requestedByName: row.requested_by_name,
    requestedByEmail: row.requested_by_email,
    clientNeed: row.client_need,
    typicalUseCase: row.typical_use_case,
    desiredDeliverables: row.desired_deliverables,
    whyProductize: row.why_productize,
    suggestedPhase: row.suggested_phase ?? "",
    suggestedCategory: row.suggested_category ?? "",
    suggestedTactic: row.suggested_tactic ?? "",
    inScope: row.in_scope ?? "",
    outOfScope: row.out_of_scope ?? "",
    knownWork: row.known_work ?? "",
    relatedOfferings: row.related_offerings ?? "",
    additionalNotes: row.additional_notes ?? "",
    priority: row.priority,
  };
}

export function requestPayloadFromFeedbackBoardRow(row: FeedbackBoardRow): ProductiveRequestPayload {
  return {
    solutionName: row.title,
    requestedByName: row.requested_by_name,
    requestedByEmail: row.requested_by_email,
    clientNeed: row.client_need ?? row.details ?? "",
    typicalUseCase: row.typical_use_case ?? "",
    desiredDeliverables: row.desired_deliverables ?? "",
    whyProductize: row.why_productize ?? "",
    suggestedPhase: row.suggested_phase ?? "",
    suggestedCategory: row.suggested_category ?? "",
    suggestedTactic: row.suggested_tactic ?? "",
    inScope: "",
    outOfScope: "",
    knownWork: "",
    relatedOfferings: "",
    additionalNotes: row.additional_notes ?? "",
    priority: row.priority,
  };
}

async function readFunctionsInvokeError(
  error: { message?: string; context?: unknown },
  data: unknown
): Promise<string> {
  if (data && typeof data === "object" && "error" in data && (data as { error?: unknown }).error) {
    return String((data as { error: unknown }).error);
  }
  const ctx = error.context;
  if (ctx && typeof ctx === "object") {
    const response = ctx as {
      json?: () => Promise<unknown>;
      text?: () => Promise<string>;
      clone?: () => { json?: () => Promise<unknown>; text?: () => Promise<string> };
    };
    const bodySource = typeof response.clone === "function" ? response.clone() : response;
    try {
      if (typeof bodySource.json === "function") {
        const body = await bodySource.json();
        if (body && typeof body === "object" && "error" in body && (body as { error?: unknown }).error) {
          return String((body as { error: unknown }).error);
        }
        if (typeof body === "string" && body.trim()) return body.trim();
        if (body && typeof body === "object") return JSON.stringify(body);
      }
    } catch {
      /* fall through */
    }
    try {
      if (typeof bodySource.text === "function") {
        const text = (await bodySource.text()).trim();
        if (text) return text.slice(0, 400);
      }
    } catch {
      /* fall through */
    }
  }
  return error.message?.trim() || "Edge Function returned a non-2xx status code";
}

async function invokeProductiveTaskList(args: {
  requestId: string;
  source: ProductiveTaskListSource;
  existingTaskListId?: string | null;
  request: ProductiveRequestPayload;
}): Promise<ProductiveTaskListResult> {
  const client = getSupabase();
  if (!client) return { ok: false, error: "Supabase not configured" };

  try {
    const { data, error } = await client.functions.invoke("create-productive-solution-tasks", {
      body: {
        requestId: args.requestId,
        source: args.source,
        existingTaskListId: args.existingTaskListId ?? null,
        request: args.request,
        appUrl: typeof window !== "undefined" ? window.location.origin : null,
      },
    });

    if (error) {
      const msg = await readFunctionsInvokeError(error, data);
      console.warn("[create-productive-solution-tasks]", msg, data);
      return { ok: false, error: msg };
    }
    if (data && typeof data === "object" && "error" in data && (data as { error?: unknown }).error) {
      const msg = String((data as { error: unknown }).error);
      console.warn("[create-productive-solution-tasks]", msg);
      return { ok: false, error: msg };
    }

    const payload = (data ?? {}) as {
      ok?: boolean;
      skipped?: boolean;
      taskListId?: unknown;
      url?: unknown;
    };
    const taskListId = typeof payload.taskListId === "string" ? payload.taskListId : "";
    const url = typeof payload.url === "string" ? payload.url : "";
    if (!taskListId || !url) {
      return { ok: false, error: "Productive did not return a task list link." };
    }
    return {
      ok: true,
      skipped: Boolean(payload.skipped),
      taskListId,
      url,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[create-productive-solution-tasks]", msg);
    return { ok: false, error: msg };
  }
}

/**
 * Creates (or returns) the Productive task list for an approved solution request.
 * Failures are returned to the caller so approval can still succeed.
 */
export async function createProductiveSolutionTasks(
  row: SolutionRequest
): Promise<ProductiveTaskListResult> {
  return invokeProductiveTaskList({
    requestId: row.id,
    source: "solution_request",
    existingTaskListId: row.productive_task_list_id ?? null,
    request: requestPayloadFromSolutionRequest(row),
  });
}

/** Creates (or returns) Productive tasks for a Feedback new-solution row (legacy or app_feedback). */
export async function createProductiveTasksForFeedbackRow(
  row: FeedbackBoardRow
): Promise<ProductiveTaskListResult> {
  return invokeProductiveTaskList({
    requestId: row.id,
    source: row.source,
    existingTaskListId: row.productive_task_list_id ?? null,
    request: requestPayloadFromFeedbackBoardRow(row),
  });
}
