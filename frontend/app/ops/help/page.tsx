"use client";

// Operator quickstart — the one page a venue needs to run a service without
// the founder in the room. Content is inline (not in the shared dict) so it
// reads as a document, printable via the browser.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { useT } from "@/lib/LocaleContext";

interface Step {
  title: string;
  body: string;
}

const STEPS_JA: Step[] = [
  {
    title: "受付",
    body: "お客様が並んだら「＋ 受付」をタップし、人数を入力して「受付する」。お名前と電話番号は任意です。",
  },
  {
    title: "案内",
    body: "席が空いたら「次を案内」をタップ。ファストパスのお客様が自動的に先頭になります。特定の組を案内する場合は、その行の「案内」をタップしてください。",
  },
  {
    title: "不在",
    body: "並んでいたお客様がいなくなった場合は、その行の「不在」をタップ。正確に記録するほど、待ち時間予測の精度が上がります。",
  },
  {
    title: "ファストパス",
    body: "並ばずに入りたいお客様には、受付時に区分を「ファストパス」にします。表示される自動見積もりの金額をお客様にご請求ください（お会計はお店で回収します）。案内した時点で売上として記録されます。",
  },
  {
    title: "販売の停止",
    body: "通常のお客様への影響が気になる時は、画面上部の「ファストパス販売中 — 停止する」をタップ。いつでも再開できます（オーナー・店長のみ）。",
  },
  {
    title: "障害時（紙で運用）",
    body: "画面に「オフライン」と表示された場合は、紙に「時刻・人数・お名前」を記録して通常どおり営業を続けてください。復旧後にまとめて入力すれば大丈夫です。",
  },
];

const STEPS_EN: Step[] = [
  {
    title: "Check in",
    body: "When a party joins the line, tap “+ Add party”, enter the party size, and save. Name and phone are optional.",
  },
  {
    title: "Seat",
    body: "When a table opens, tap “Seat next”. Fast-pass parties are automatically first. To seat a specific party, tap “Seat” on its row.",
  },
  {
    title: "Walk-away",
    body: "If a waiting party leaves, tap “Walk” on its row. Accurate records make the wait predictions better.",
  },
  {
    title: "Fast pass",
    body: "For guests who want to skip the line, set the type to Premium when checking in. Charge the quoted amount (the restaurant collects it). It counts as a sale when you seat them.",
  },
  {
    title: "Pausing sales",
    body: "If the regular line seems affected, tap “PREMIUM ON — pause” in the header. Resume any time (owner/manager only).",
  },
  {
    title: "If it goes offline",
    body: "If the screen shows OFFLINE, write time, party size, and name on paper and keep serving as usual. Enter the entries when it recovers.",
  },
];

export default function HelpPage() {
  const router = useRouter();
  const { token, user, loading: authLoading } = useAuth();
  const { t, locale } = useT();

  useEffect(() => {
    if (!authLoading && !token) router.replace("/login");
  }, [authLoading, token, router]);

  if (authLoading || !user) {
    return (
      <main className="flex-1 flex items-center justify-center">
        <p className="text-sm text-ifasto-secondary">{t.common.loading}</p>
      </main>
    );
  }

  const steps = locale === "ja" ? STEPS_JA : STEPS_EN;
  const heading = locale === "ja" ? "使い方（クイックガイド）" : "Quickstart";
  const printLabel = locale === "ja" ? "印刷する" : "Print";
  const support =
    locale === "ja"
      ? "困った時は: arnav@ifasto.com（日本語可）"
      : "Need help? arnav@ifasto.com";

  return (
    <main className="flex-1 max-w-2xl mx-auto w-full px-5 py-8 print:py-2">
      <header className="flex items-center justify-between mb-8 print:mb-4">
        <div>
          <p className="font-display text-2xl tracking-tight leading-none">
            {heading}
          </p>
          <p className="text-xs text-ifasto-secondary mt-1">ifasto</p>
        </div>
        <div className="flex items-center gap-4 print:hidden">
          <button
            onClick={() => window.print()}
            className="text-sm text-ifasto-secondary hover:text-ifasto-text transition-colors"
          >
            {printLabel}
          </button>
          <Link
            href="/ops"
            className="text-sm text-ifasto-secondary hover:text-ifasto-text"
          >
            {t.history.backToBoard}
          </Link>
        </div>
      </header>

      <ol className="space-y-5">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-4">
            <span className="shrink-0 w-9 h-9 rounded-full bg-ifasto-text text-ifasto-bg flex items-center justify-center font-display text-lg">
              {i + 1}
            </span>
            <div>
              <p className="font-medium">{s.title}</p>
              <p className="text-sm text-ifasto-secondary leading-relaxed mt-0.5">
                {s.body}
              </p>
            </div>
          </li>
        ))}
      </ol>

      <p className="text-sm text-ifasto-secondary mt-10 pt-4 border-t border-ifasto-border">
        {support}
      </p>
    </main>
  );
}
