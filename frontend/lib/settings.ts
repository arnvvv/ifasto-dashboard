// Venue settings client — pause button + pricing caps.

import { api } from "./api";

export interface VenueSettings {
  restaurant_id: string;
  max_premium_share: number;
  price_floor: number;
  price_ceiling: number;
  max_party_size_eligible: number;
  large_party_cap_per_service: number;
  premium_paused: boolean;
  updated_at: string | null;
}

export interface VenueSettingsUpdate {
  max_premium_share?: number;
  price_floor?: number;
  price_ceiling?: number;
  max_party_size_eligible?: number;
  large_party_cap_per_service?: number;
  premium_paused?: boolean;
}

export interface QrInfo {
  qr_token: string;
  guest_url: string;
  venue_name: string;
  venue_name_ja: string | null;
  logo_url: string | null;
}

export const settingsApi = {
  get: (token: string) => api<VenueSettings>("/api/settings", { token }),
  update: (token: string, body: VenueSettingsUpdate) =>
    api<VenueSettings>("/api/settings", { method: "PATCH", body, token }),
  qr: (token: string) => api<QrInfo>("/api/settings/qr", { token }),
  rotateQr: (token: string) => api<QrInfo>("/api/settings/qr/rotate", { method: "POST", token }),
};
