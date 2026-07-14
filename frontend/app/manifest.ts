import type { MetadataRoute } from "next";

// Minimal PWA manifest so the ops board installs to the tablet home screen
// and runs standalone (no browser chrome during service). Icons are a
// follow-up polish item.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ifasto 受付ボード",
    short_name: "ifasto",
    start_url: "/ops",
    display: "standalone",
    background_color: "#FAFAF8",
    theme_color: "#0A1628",
  };
}
