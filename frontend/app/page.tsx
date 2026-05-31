"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";

export default function Home() {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    router.replace(user ? "/ops" : "/login");
  }, [loading, user, router]);

  return (
    <main className="flex-1 flex items-center justify-center px-6 py-32">
      <p className="text-sm text-ifasto-secondary">Loading…</p>
    </main>
  );
}
