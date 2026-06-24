// Typed client for the MyAL1S backend. Every deterministic endpoint returns a
// status envelope; the dashboard branches on `status`.

// ---------------------------------------------------------------------------
// Shared envelope
// ---------------------------------------------------------------------------

export type Envelope<T> =
  | { status: "ok"; data: T }
  | { status: "needs_otp"; mobile_mask: string | null; hint: string }
  | { status: "error"; message: string };

/** Default per-request timeout. A slow MCP crawl can run long, but 15s is long
 *  enough that a hung request is clearly broken, not merely slow. */
const DEFAULT_TIMEOUT_MS = 15_000;

/** Is `e` an AbortError — either our own timeout abort or a deliberate one (e.g.
 *  React unmounting a component mid-fetch)? We treat both as a CLEAN, expected
 *  condition, never a surfaced `AbortError: signal is aborted without reason`
 *  (that string leaked into the UI via String(e) before). */
function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === "AbortError";
}

/** fetch + a timeout. On abort (timeout or otherwise) we throw a typed Error so
 *  callers can map it to a friendly message instead of `String(AbortError)`. */
async function fetchWithTimeout(
  input: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

async function getEnvelope<T>(path: string): Promise<Envelope<T>> {
  try {
    // Deterministic endpoints crawl the teaching network (the calendar's
    // composer joins several sources), which can run longer than a single-tool
    // call on a cold cache — allow 30s. (A real hang is still bounded; and the
    // frontend falls back to the cached snapshot on timeout anyway.)
    const res = await fetchWithTimeout(`/api${path}`, {}, 30_000);
    if (!res.ok) return { status: "error", message: `HTTP ${res.status}` };
    return (await res.json()) as Envelope<T>;
  } catch (e) {
    // An abort (timeout / unmount) is a clean expected condition — surface a
    // short friendly message, never the raw `AbortError: ...` string.
    return { status: "error", message: isAbort(e) ? "请求超时或已取消" : String(e) };
  }
}

async function postJSON<T>(path: string, body: unknown, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  try {
    const res = await fetchWithTimeout(
      `/api${path}`,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
      timeoutMs,
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } catch (e) {
    // Translate aborts to a friendly error so the UI shows "请求超时" rather than
    // the raw AbortError string; rethrow so the caller's catch still runs.
    throw isAbort(e) ? new Error("请求超时或已取消") : e;
  }
}

// ---------------------------------------------------------------------------
// Teaching-network read-only data (deterministic, no LLM)
// ---------------------------------------------------------------------------

export interface Assignment {
  id: string;
  course: string;
  title: string;
  deadline: string | null; // RFC3339
  deadline_raw: string | null;
  submitted: boolean;
  last_attempt: string | null;
}

export interface Grade {
  course: string;
  item: string;
  score: number | null;
  possible: number;
}

export interface Announcement {
  id: string;
  course: string;
  title: string;
  time: string | null; // RFC3339 / server format
  descriptions: string[];
  attachments: string[];
}

export interface Material {
  course: string;
  ccid: string; // course_id:content_id
  title: string;
  kind: string; // CourseContentKind Debug name
  attachment_count: number;
}

export interface Video {
  id: string;
  course: string;
  title: string;
  time: string;
}

export const fetchAssignments = (includeFinished = false) =>
  getEnvelope<{ assignments: Assignment[]; include_finished: boolean }>(
    `/assignments?include_finished=${includeFinished}`,
  );

export const fetchGrades = () => getEnvelope<{ grades: Grade[] }>("/grades");

export const fetchAnnouncements = () =>
  getEnvelope<{ announcements: Announcement[] }>("/announcements");

export const fetchMaterials = () => getEnvelope<{ materials: Material[] }>("/materials");

export const fetchVideos = () => getEnvelope<{ videos: Video[] }>("/videos");

// ---------------------------------------------------------------------------
// Stars / custom items / todo / calendar / new notices (P1 dashboard)
// ---------------------------------------------------------------------------

export type StarSource = "assignment" | "announcement";

export interface Star {
  source: StarSource;
  item_id: string;
  title: string | null;
  course: string | null;
  date: string | null;
  created_at: string;
}

/** A composed 待办/calendar item from the backend Composer. */
export interface TodoItem {
  kind: "star" | "custom";
  id: string;
  /** For stars: "assignment" | "announcement". For custom items: a free-form
   * origin label (e.g. "微信群"). */
  source?: string;
  custom_id?: number;
  title: string | null;
  course: string | null;
  date: string | null;
  live?: boolean; // star only: was it found in the live list?
  submitted?: boolean | null; // assignment star only: submitted flag (null if unknown)
  // custom only:
  note?: string | null;
  done?: boolean;
}

export interface CalendarView {
  course_table: Envelope<unknown>;
  items: TodoItem[];
  week: string; // YYYY-Www
}

export interface NewNotices {
  assignment: Assignment[];
  announcement: Announcement[];
}

export interface CustomItemInput {
  title: string;
  due?: string | null;
  note?: string | null;
  course?: string | null;
  source?: string | null;
}

export const fetchStars = () => getEnvelope<{ stars: Star[] }>("/stars");

export async function setStar(
  source: StarSource,
  item_id: string,
  snapshot: { title?: string | null; course?: string | null; date?: string | null } = {},
): Promise<void> {
  await postJSON("/stars", { source, item_id, ...snapshot });
}

export async function removeStar(source: StarSource, item_id: string): Promise<void> {
  const res = await fetchWithTimeout(`/api/stars/${source}/${encodeURIComponent(item_id)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

export const createCustomItem = (item: CustomItemInput) =>
  postJSON<{ status: string; id: number }>("/custom-items", item);

export async function updateCustomItem(
  id: number,
  patch: Partial<CustomItemInput & { done: boolean }>,
): Promise<void> {
  const res = await fetchWithTimeout(`/api/custom-items/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

export async function deleteCustomItem(id: number): Promise<void> {
  const res = await fetchWithTimeout(`/api/custom-items/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

export const fetchTodo = () => getEnvelope<{ items: TodoItem[] }>("/todo");

export const fetchCalendar = (week: string | null) =>
  getEnvelope<CalendarView>(`/calendar${week ? `?week=${encodeURIComponent(week)}` : ""}`);

export const fetchNewNotices = () => getEnvelope<NewNotices>("/new-notices");

export const markNoticesSeen = () => postJSON<{ status: string }>("/new-notices/mark-seen", {});

// ---------------------------------------------------------------------------
// Chat (the LLM path) — extended in P1
// ---------------------------------------------------------------------------

export interface ChatTraceEntry {
  type: "tool_call" | "tool_result";
  tool: string;
  args?: unknown;
  content?: string;
}

export interface ChatResult {
  reply: string;
  trace: ChatTraceEntry[];
  conversation_id: string;
}

export interface ModelOption {
  label: string;
  model: string;
}

export interface ConversationSummary {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConversationMessage {
  id: number;
  role: "user" | "assistant";
  content: string | null;
  created_at: string;
}

export function sendChat(
  message: string,
  opts: { model?: string; conversation_id?: string; attachment_file_id?: string } = {},
): Promise<ChatResult> {
  return postJSON<ChatResult>("/chat", {
    message,
    model: opts.model ?? null,
    conversation_id: opts.conversation_id ?? null,
    attachment_file_id: opts.attachment_file_id ?? null,
  });
}

export async function getModels(): Promise<{ models: ModelOption[] }> {
  const res = await fetchWithTimeout("/api/models");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as { models: ModelOption[] };
}

export async function listConversations(): Promise<ConversationSummary[]> {
  const res = await fetchWithTimeout("/api/conversations");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).conversations;
}

export async function getConversation(
  id: string,
): Promise<{ id: string; messages: ConversationMessage[] }> {
  const res = await fetchWithTimeout(`/api/conversations/${id}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as { id: string; messages: ConversationMessage[] };
}

export async function deleteConversation(id: string): Promise<void> {
  const res = await fetchWithTimeout(`/api/conversations/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

// ---------------------------------------------------------------------------
// P2 write-ops: uploads / approvals / submit / permissions
// ---------------------------------------------------------------------------

export interface Approval {
  id: string;
  conversation_id: string | null;
  tool_name: string;
  group_name: string;
  args: Record<string, unknown>;
  filename: string | null;
  summary: string | null;
  status: "pending" | "denied" | "executed" | "failed";
  result: Record<string, unknown> | null;
  created_at: string;
  decided_at: string | null;
}

export interface UploadResult {
  file_id: string;
  filename: string;
}

export interface PermissionEntry {
  group: string;
  level: string | null; // null = the default (confirm)
}

export interface Permissions {
  groups: PermissionEntry[];
  default: string;
  valid_levels: string[];
}

/** Upload a chat attachment. Multipart → steps outside postJSON. 15s timeout.
 * Returns an opaque file_id the agent passes to submit_assignment. */
export async function uploadAttachment(file: File): Promise<UploadResult> {
  const form = new FormData();
  form.append("file", file);
  try {
    const res = await fetchWithTimeout("/api/uploads", { method: "POST", body: form });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as UploadResult;
  } catch (e) {
    throw isAbort(e) ? new Error("上传超时或已取消") : e;
  }
}

/** UI direct submit (implicit confirm). Multipart: assignment_id + file. */
export async function submitAssignment(
  assignmentId: string,
  file: File,
): Promise<Record<string, unknown>> {
  const form = new FormData();
  form.append("assignment_id", assignmentId);
  form.append("file", file);
  try {
    // Uploading a homework file may take longer than a normal request.
    const res = await fetchWithTimeout("/api/submit", { method: "POST", body: form }, 60_000);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as Record<string, unknown>;
  } catch (e) {
    throw isAbort(e) ? new Error("提交超时或已取消") : e;
  }
}

export const fetchApprovals = (status?: "pending" | "denied" | "executed" | "failed") =>
  getEnvelope<{ approvals: Approval[] }>(`/approvals${status ? `?status=${status}` : ""}`);

export async function decideApproval(
  approvalId: string,
  decision: "confirm" | "deny",
): Promise<Record<string, unknown>> {
  return postJSON(`/approvals/${encodeURIComponent(approvalId)}/decide`, { decision });
}

export async function fetchPermissions(): Promise<Permissions> {
  try {
    const res = await fetchWithTimeout("/api/permissions");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as Permissions;
  } catch (e) {
    throw isAbort(e) ? new Error("请求超时或已取消") : e;
  }
}

export async function setPermission(group: string, level: string): Promise<void> {
  const res = await fetchWithTimeout(`/api/permissions/${encodeURIComponent(group)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ level }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

// ---------------------------------------------------------------------------
// Deferred sources (P3) — TYPED CONTRACTS ONLY, no fetcher.
// These panels render a "待接入 (P3)" empty state today; the types document the
// shape P3 implements against. dean/treehole → future MCP tools (see
// docs/mcp-protocol.md); doc library / memory → future backend endpoints (see
// docs/architecture.md). No backend route exists for any of these yet.
// ---------------------------------------------------------------------------

/** Future MCP tool: get_dean_updates (dean's-office notices). */
export interface DeanUpdate {
  id: string;
  title: string;
  time: string | null;
  category: string | null;
  url: string | null;
  summary: string | null;
}

/** 树洞帖子 (MCP: treehole_list/search)。字段来自 spike 实测。 */
export interface TreeholePost {
  pid: number;
  text: string;
  time: string | null;
  timestamp: number;
  reply: number;
  likenum: number;
  tag: string | null;
}

/** 树洞通知（关注帖子更新）。轻量替代全量爬取。 */
export interface TreeholeNotice {
  unread: number;
  messages: { description: string; pid: number | null; time: string | null }[];
}

/** 树洞通知面板数据（确定性，不过 LLM）。 */
export const fetchTreehole = () =>
  getEnvelope<TreeholeNotice>("/treehole");

/** Future backend endpoint: /api/docs/search (personal document library). */
export interface DocResult {
  id: string;
  title: string;
  course: string | null;
  kind: string; // e.g. pdf / note / slide
  snippet: string | null;
  url: string | null;
}

/** Future backend endpoint: /api/memory (long-term agent memory / 记忆). */
export interface MemoryEntry {
  id: string;
  text: string;
  tags: string[];
  created_at: string;
}

// ---------------------------------------------------------------------------
// Login (one-time OTP) — unchanged from P0
// ---------------------------------------------------------------------------

export interface LoginResult {
  portal: boolean;
  blackboard: boolean;
}

export async function login(otp: string): Promise<Envelope<LoginResult>> {
  try {
    return await postJSON<Envelope<LoginResult>>("/login", { otp });
  } catch (e) {
    return { status: "error", message: String(e) };
  }
}

/** Cheap single connection check — the dashboard's "am I logged in?" gate. Used
 *  to show one "未连接，请登录" notice instead of every panel cold-crawling. Has a
 *  timeout so a hung backend can't leave the gate spinning on "检查连接…" — on
 *  any failure (including an abort) it reports not-connected, so the notice
 *  shows instead of a perpetual 加载中. */
export async function fetchSession(): Promise<{ connected: boolean }> {
  try {
    const res = await fetchWithTimeout("/api/session");
    if (!res.ok) return { connected: false };
    return (await res.json()) as { connected: boolean };
  } catch {
    return { connected: false }; // timeout / network → treat as not connected
  }
}
