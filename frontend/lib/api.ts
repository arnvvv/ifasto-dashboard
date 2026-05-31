// Thin fetch wrapper. In production both halves are on app.ifasto.com so
// API_BASE is '' (relative). In dev the backend is on :8000.

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ??
  (typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "http://localhost:8000"
    : "");

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
  }
}

interface ApiOpts {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  form?: Record<string, string>;
  token?: string | null;
}

export async function api<T = unknown>(path: string, opts: ApiOpts = {}): Promise<T> {
  const { method = "GET", body, form, token } = opts;
  const headers: Record<string, string> = {};
  let serializedBody: string | URLSearchParams | undefined;

  if (form) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    serializedBody = new URLSearchParams(form);
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    serializedBody = JSON.stringify(body);
  }
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: serializedBody as BodyInit | undefined,
  });

  // 204 No Content
  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const parsed = text ? safeJsonParse(text) : undefined;
  if (!res.ok) {
    const detail =
      (parsed as { detail?: string } | undefined)?.detail ?? res.statusText;
    throw new ApiError(res.status, detail, parsed);
  }
  return parsed as T;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
