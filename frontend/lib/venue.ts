// Venue display info for the branded ops-board header.

import { api } from "./api";

export interface Venue {
  name: string;
  name_ja: string | null;
  logo_url: string | null;
}

export const venueApi = {
  get: (token: string) => api<Venue>("/api/venue", { token }),
};
