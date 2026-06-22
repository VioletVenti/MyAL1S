// Typed client for the MyAL1S backend. Every deterministic endpoint returns a
// status envelope; the dashboard branches on `status`.

// ---------------------------------------------------------------------------
// Shared envelope
// ---------------------------------------------------------------------------

export type Envelope<T> =
  | { status: "ok"; data: T }
  | { status: "needs_otp"; mobile_mask: string | null; hint: string }
  | { status: "error"; message: string };

async function getEnvelope<T>(path: string): Promise<Envelope<T>> {
  try {
    // 15s timeout — prevents the loading indicator from hanging forever when
    // the backend is slow (MCP crawl) or unreachable.
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 15_000);
    const res = await fetch(`/api${path}`, { signal: controller.signal });
    clearTimeout(id);
    if (!res.ok) return { status: "error", message: `HTTP ${res.status}` };
    return (await res.json()) as Envelope<T>;
  } catch (e) {
    return { status: "error", message: String(e) };
  }
}

async function postJSON<T>(path: string, body: unknown): Promise<T> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(`/api${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(id);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } catch (e) {
    clearTimeout(id);
    throw e;
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
  const res = await fetch(`/api/stars/${source}/${encodeURIComponent(item_id)}`, {
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
  const res = await fetch(`/api/custom-items/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

export async function deleteCustomItem(id: number): Promise<void> {
  const res = await fetch(`/api/custom-items/${id}`, { method: "DELETE" });
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
  opts: { model?: string; conversation_id?: string } = {},
): Promise<ChatResult> {
  return postJSON<ChatResult>("/chat", {
    message,
    model: opts.model ?? null,
    conversation_id: opts.conversation_id ?? null,
  });
}

export async function getModels(): Promise<{ models: ModelOption[] }> {
  const res = await fetch("/api/models");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as { models: ModelOption[] };
}

export async function listConversations(): Promise<ConversationSummary[]> {
  const res = await fetch("/api/conversations");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).conversations;
}

export async function getConversation(
  id: string,
): Promise<{ id: string; messages: ConversationMessage[] }> {
  const res = await fetch(`/api/conversations/${id}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as { id: string; messages: ConversationMessage[] };
}

export async function deleteConversation(id: string): Promise<void> {
  const res = await fetch(`/api/conversations/${id}`, { method: "DELETE" });
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

/** Future MCP tools: list_treehole_posts / get_treehole_post (北大树洞). */
export interface TreeholePost {
  id: string;
  title: string | null;
  body: string;
  author: string | null;
  time: string | null;
  tags: string[];
  reply_count: number;
}

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
