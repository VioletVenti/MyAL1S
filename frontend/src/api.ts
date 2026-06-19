// Typed client for the MyAL1S backend. Every deterministic endpoint returns a
// status envelope; the dashboard branches on `status`.

export type Envelope<T> =
  | { status: "ok"; data: T }
  | { status: "needs_otp"; mobile_mask: string | null; hint: string }
  | { status: "error"; message: string };

export interface Assignment {
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

async function getEnvelope<T>(path: string): Promise<Envelope<T>> {
  try {
    const res = await fetch(`/api${path}`);
    if (!res.ok) return { status: "error", message: `HTTP ${res.status}` };
    return (await res.json()) as Envelope<T>;
  } catch (e) {
    return { status: "error", message: String(e) };
  }
}

export const fetchCourseTable = () => getEnvelope<unknown>("/course-table");

export const fetchAssignments = (includeFinished = false) =>
  getEnvelope<{ assignments: Assignment[]; include_finished: boolean }>(
    `/assignments?include_finished=${includeFinished}`,
  );

export const fetchGrades = () => getEnvelope<{ grades: Grade[] }>("/grades");

export async function sendChat(message: string): Promise<string> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { reply: string };
  return data.reply;
}

export interface LoginResult {
  portal: boolean;
  blackboard: boolean;
}

// One-time login: send a user-provided OTP to warm the session. After this,
// dashboard/chat calls reuse the session (no per-call OTP) until it expires.
export async function login(otp: string): Promise<Envelope<LoginResult>> {
  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ otp }),
    });
    if (!res.ok) return { status: "error", message: `HTTP ${res.status}` };
    return (await res.json()) as Envelope<LoginResult>;
  } catch (e) {
    return { status: "error", message: String(e) };
  }
}
