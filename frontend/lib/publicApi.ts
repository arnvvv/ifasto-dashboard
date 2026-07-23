// Guest-facing API client. No auth: tenancy comes from the venue qr_token
// in the URL, and the entry UUID acts as the status capability.

import { API_BASE } from "./api";

export interface PublicVenue {
  venue_name: string;
  venue_name_ja: string | null;
  logo_url: string | null;
  waiting: number;
  accepting: boolean;
}

export interface PublicEntry {
  entry_id: string;
  ticket_no: number;
  status: "waiting" | "seated" | "walked_away";
  party_size: number;
  parties_ahead: number;
  est_remaining_mins: number | null;
  est_remaining_p10: number | null;
  est_remaining_p90: number | null;
  venue_name: string;
  venue_name_ja: string | null;
  entry_type: "regular" | "premium";
  paid_amount: number | null;
}

export class PublicApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      if (typeof body?.detail === "string") detail = body.detail;
    } catch {
      // non-JSON error body; statusText is enough
    }
    throw new PublicApiError(res.status, detail);
  }
  return res.json() as Promise<T>;
}

export function getVenue(token: string): Promise<PublicVenue> {
  return req(`/api/public/venue/${encodeURIComponent(token)}`);
}

export function joinQueue(token: string, partySize: number): Promise<PublicEntry> {
  return req(`/api/public/venue/${encodeURIComponent(token)}/join`, {
    method: "POST",
    body: JSON.stringify({ party_size: partySize }),
  });
}

export function getEntry(entryId: string): Promise<PublicEntry> {
  return req(`/api/public/entry/${encodeURIComponent(entryId)}`);
}

export function leaveQueue(entryId: string): Promise<PublicEntry> {
  return req(`/api/public/entry/${encodeURIComponent(entryId)}/leave`, {
    method: "POST",
  });
}

// localStorage memory of the guest's active ticket so a re-scan or page
// reload can return them to it instead of double-joining.
const TICKET_KEY = "ifasto.guest.ticket";

export interface StoredTicket {
  entryId: string;
  token: string;
  savedAt: number;
}

export function saveTicket(entryId: string, token: string): void {
  try {
    window.localStorage.setItem(
      TICKET_KEY,
      JSON.stringify({ entryId, token, savedAt: Date.now() } satisfies StoredTicket)
    );
  } catch {
    // private mode / quota — ticket page still works via the redirect URL
  }
}

export function loadTicket(): StoredTicket | null {
  try {
    const raw = window.localStorage.getItem(TICKET_KEY);
    if (!raw) return null;
    const t = JSON.parse(raw) as StoredTicket;
    // Stale after 6 hours — nobody waits that long; don't resurrect old tickets.
    if (!t.entryId || Date.now() - t.savedAt > 6 * 60 * 60 * 1000) return null;
    return t;
  } catch {
    return null;
  }
}

export function clearTicket(): void {
  try {
    window.localStorage.removeItem(TICKET_KEY);
  } catch {
    // ignore
  }
}
