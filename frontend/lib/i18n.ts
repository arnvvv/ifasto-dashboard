// Dashboard string table. JAPANESE-FIRST: the operators are Tokyo restaurant
// staff; EN exists for the founder and future non-JP venues. Register follows
// Japanese POS/queue-system conventions: terse noun-style labels for actions
// (案内, 不在, 受付), です・ます for sentences. Terminology matches the
// verified market vocabulary: ファストパス (the pass), 順番待ち (the queue),
// 組 (party counter), 名様 (guest-facing party size).
//
// The /ops/survey page stays English on purpose: it is a founder field tool.

export type Locale = "ja" | "en";

export const LOCALES: { code: Locale; label: string }[] = [
  { code: "ja", label: "日本語" },
  { code: "en", label: "EN" },
];

// Japanese-first: an account without language_pref and without a manual
// override gets Japanese.
export const DEFAULT_LOCALE: Locale = "ja";

export interface Dict {
  common: {
    loading: string;
    signOut: string;
    cancel: string;
    save: string;
    saving: string;
    close: string;
    optional: string;
    minutes: (n: number) => string;
    partyOf: (n: number) => string;
    roleLabel: (role: string) => string;
  };

  login: {
    subtitle: string;
    email: string;
    password: string;
    signIn: string;
    signingIn: string;
    badCredentials: string;
    failed: (status: number, msg: string) => string;
    network: string;
    issuedNote: string;
    issuedContact: string;
  };

  ops: {
    title: string;
    signedInAs: (name: string) => string;
    live: string;
    offline: string;
    liveTooltip: string;
    offlineTooltip: string;
    premiumOn: string;
    premiumPaused: string;
    pauseTooltipOn: string;
    pauseTooltipPaused: string;
    ownerOnly: string;
    caps: string;
    help: string;
    qrSign: string;
    history: string;
    survey: string;
    account: string;

    tileWaiting: string;
    tileRegular: string;
    tilePremium: string;
    tileMedianWait: string;
    tileSeatedToday: string;
    tilePremiumToday: string;

    quickAdd: string;
    quickAddDetail: string;
    ticket: (n: number) => string;
    undo: string;
    undoSeated: (ticket: string) => string;
    undoWalked: (ticket: string) => string;
    errUndo: string;
    offlineBanner: string;

    nextUp: string;
    queueEmpty: string;
    walkIn: string;
    premiumChip: string;
    addParty: string;
    seatNext: string;

    colPremium: string;
    colRegular: string;
    emptyPremium: string;
    emptyRegular: string;
    waited: (mins: number) => string;
    seat: string;
    walk: string;

    errSeat: string;
    errWalk: string;
    errPause: string;
    errQueueLoad: (status: number, msg: string) => string;
    errQueueNetwork: string;
    errAdd: string;
  };

  modal: {
    title: string;
    partySize: string;
    type: string;
    typeRegular: string;
    typePremium: string;
    name: string;
    phone: string;
    notes: string;
    fetchingQuote: string;
    engineQuote: string;
    quoteWait: (mins: number) => string;
    quoteLocked: string;
    noQuote: (reason: string) => string;
    skipPrice: string;
    submit: string;
    submitting: string;
  };

  caps: {
    maxShare: string;
    ceiling: string;
    maxEligible: string;
    largeCap: string;
    saveCaps: string;
    errSave: string;
  };

  tile: {
    label: (party: number) => string;
    fetching: string;
    liveSub: string;
    waitSub: (mins: number) => string;
    paused: string;
    capReached: string;
    outOfHours: string;
    engineOffline: string;
    offline: string;
    unavailable: string;
  };

  history: {
    title: string;
    subtitle: (days: number) => string;
    backToBoard: string;
    seated7: string;
    walked7: string;
    premiumSold7: string;
    premiumRevenue7: string;
    medianWait7: string;
    newBadge: string;
    wowSuffix: string;
    colDate: string;
    colSeated: string;
    colWalked: string;
    colPremium: string;
    colPremiumRevenue: string;
    colMedianWait: string;
    colPremiumSaves: string;
    spike: string;
    spikeTooltip: string;
    empty: string;
    errLoad: string;
    min: string;
  };

  account: {
    title: string;
    backToBoard: string;
    changePassword: string;
    newPassword: string;
    repeatPassword: string;
    tooShort: string;
    mismatch: string;
    updated: string;
    failed: (status: number) => string;
    network: string;
    update: string;
    updating: string;
    language: string;
  };
  guest: {
    joinTitle: string;
    waitingNow: (n: number) => string;
    partySize: string;
    people: (n: number) => string;
    join: string;
    joining: string;
    queueFull: string;
    tooMany: string;
    unknownVenue: string;
    network: string;
    returnToTicket: string;
    ticketTitle: string;
    ticketNo: (n: number) => string;
    partiesAhead: (n: number) => string;
    estWait: (m: number) => string;
    waitUnknown: string;
    statusWaiting: string;
    statusSeated: string;
    statusSeatedBody: string;
    statusWalked: string;
    statusWalkedBody: string;
    keepOpen: string;
    leave: string;
    leaveConfirm: string;
    leaveYes: string;
    leaveNo: string;
    poweredBy: string;
  };
  qrSign: {
    title: string;
    scanToJoin: string;
    subtitle: string;
    print: string;
    rotate: string;
    rotateConfirm: string;
    rotated: string;
    backToBoard: string;
    urlLabel: string;
  };
}

export const ja: Dict = {
  common: {
    loading: "読み込み中…",
    signOut: "ログアウト",
    cancel: "キャンセル",
    save: "保存",
    saving: "保存中…",
    close: "閉じる",
    optional: "任意",
    minutes: (n) => `${n}分`,
    partyOf: (n) => `${n}名様`,
    roleLabel: (r) =>
      r === "owner" ? "オーナー" : r === "manager" ? "店長" : "スタッフ",
  },

  login: {
    subtitle: "店舗ダッシュボード",
    email: "メールアドレス",
    password: "パスワード",
    signIn: "ログイン",
    signingIn: "ログイン中…",
    badCredentials: "メールアドレスまたはパスワードが正しくありません。",
    failed: (s, m) => `ログインに失敗しました（${s}）: ${m}`,
    network: "通信エラーです。もう一度お試しください。",
    issuedNote: "アカウントは ifasto が発行します。ご希望の方は",
    issuedContact: "までご連絡ください。",
  },

  ops: {
    title: "ifasto · 受付ボード",
    signedInAs: (name) => `ログイン中: ${name}`,
    live: "接続中",
    offline: "オフライン",
    liveTooltip: "リアルタイム更新が有効です",
    offlineTooltip: "再接続しています…",
    premiumOn: "ファストパス販売中（タップで停止）",
    premiumPaused: "ファストパス停止中（タップで再開）",
    pauseTooltipOn: "ファストパスの販売をすぐに停止します",
    pauseTooltipPaused: "ファストパスの販売を再開します",
    ownerOnly: "オーナー・店長のみ操作できます",
    caps: "上限設定",
    help: "使い方",
    qrSign: "店頭QR",
    history: "履歴",
    survey: "調査",
    account: "アカウント",

    tileWaiting: "待ち組数",
    tileRegular: "通常",
    tilePremium: "ファストパス",
    tileMedianWait: "待ち中央値（本日）",
    tileSeatedToday: "本日の案内数",
    tilePremiumToday: "本日のファストパス売上",

    quickAdd: "かんたん受付",
    quickAddDetail: "＋詳細",
    ticket: (n) => `${n}番`,
    undo: "取り消し",
    undoSeated: (ticket) => `${ticket}を案内しました`,
    undoWalked: (ticket) => `${ticket}を不在にしました`,
    errUndo: "取り消しに失敗しました。",
    offlineBanner: "オフラインです。紙で記録し、復旧後に入力してください。",

    nextUp: "次のご案内",
    queueEmpty: "順番待ちはありません",
    walkIn: "ウォークイン",
    premiumChip: "ファストパス",
    addParty: "＋ 受付",
    seatNext: "次の組を案内",

    colPremium: "ファストパス",
    colRegular: "通常",
    emptyPremium: "ファストパスの待ちはありません",
    emptyRegular: "通常の待ちはありません",
    waited: (m) => `待ち ${m}分`,
    seat: "案内",
    walk: "不在",

    errSeat: "案内の処理に失敗しました。",
    errWalk: "不在の処理に失敗しました。",
    errPause: "ファストパスの状態を変更できませんでした。",
    errQueueLoad: (s, m) => `順番待ちを取得できませんでした（${s}）: ${m}`,
    errQueueNetwork: "サーバーに接続できません。",
    errAdd: "受付に失敗しました。",
  },

  modal: {
    title: "受付",
    partySize: "人数",
    type: "区分",
    typeRegular: "通常",
    typePremium: "ファストパス",
    name: "お名前（任意）",
    phone: "電話番号（任意）",
    notes: "メモ（任意）",
    fetchingQuote: "価格を取得しています…",
    engineQuote: "自動見積もり:",
    quoteWait: (m) => `予測待ち 約${m}分`,
    quoteLocked: "5分間有効",
    noQuote: (reason) => `自動見積もりを取得できません（${reason}）。金額を手入力してください。`,
    skipPrice: "ファストパス料金（¥・お客様への請求額）",
    submit: "受付する",
    submitting: "受付中…",
  },

  caps: {
    maxShare: "ファストパス比率の上限（%）",
    ceiling: "価格の上限（¥）",
    maxEligible: "ファストパス対象の最大人数",
    largeCap: "大人数ファストパス枠（1営業回あたり）",
    saveCaps: "上限を保存",
    errSave: "上限を保存できませんでした。",
  },

  tile: {
    label: (p) => `ファストパス価格 · ${p}名`,
    fetching: "取得中",
    liveSub: "ライブ",
    waitSub: (m) => `予測待ち 約${m}分`,
    paused: "停止中",
    capReached: "上限到達",
    outOfHours: "営業時間外",
    engineOffline: "エンジン停止",
    offline: "オフライン",
    unavailable: "取得不可",
  },

  history: {
    title: "ifasto · 履歴",
    subtitle: (d) => `過去${d}日間 · 日本時間`,
    backToBoard: "← ボードへ戻る",
    seated7: "案内数（7日）",
    walked7: "不在数（7日）",
    premiumSold7: "FP販売数（7日）",
    premiumRevenue7: "FP売上（7日）",
    medianWait7: "待ち中央値（7日）",
    newBadge: "新規",
    wowSuffix: "分（前週比）",
    colDate: "日付",
    colSeated: "案内",
    colWalked: "不在",
    colPremium: "FP",
    colPremiumRevenue: "FP売上",
    colMedianWait: "待ち中央値",
    colPremiumSaves: "FP短縮時間",
    spike: "急増",
    spikeTooltip:
      "不在率が平均の1.5倍を超えています。ファストパスが通常のお客様に影響していないかご確認ください（停止ボタンで一時停止できます）",
    empty: "この期間の記録はまだありません。順番待ちの利用が始まると表示されます。",
    errLoad: "レポートを取得できませんでした。",
    min: "分",
  },

  account: {
    title: "アカウント",
    backToBoard: "← ボードへ戻る",
    changePassword: "パスワード変更",
    newPassword: "新しいパスワード（8文字以上）",
    repeatPassword: "新しいパスワード（確認）",
    tooShort: "パスワードは8文字以上で入力してください。",
    mismatch: "パスワードが一致しません。",
    updated: "パスワードを変更しました。次回ログインから新しいパスワードをお使いください。",
    failed: (s) => `パスワードを変更できませんでした（${s}）。`,
    network: "通信エラーです。もう一度お試しください。",
    update: "変更する",
    updating: "変更中…",
    language: "表示言語",
  },
  guest: {
    joinTitle: "順番待ちに参加",
    waitingNow: (n) => `現在 ${n} 組待ち`,
    partySize: "人数を選んでください",
    people: (n) => `${n}名`,
    join: "受付する",
    joining: "受付中…",
    queueFull: "ただいま満員のため、店頭スタッフにお声がけください。",
    tooMany: "受付回数の上限に達しました。しばらくしてからお試しください。",
    unknownVenue: "このQRコードは無効です。店頭スタッフにお声がけください。",
    network: "通信エラーです。もう一度お試しください。",
    returnToTicket: "受付済みの整理券を表示",
    ticketTitle: "整理券",
    ticketNo: (n) => `${n}番`,
    partiesAhead: (n) => `あと ${n} 組`,
    estWait: (m) => `目安 約${m}分`,
    waitUnknown: "待ち時間は店頭でご確認ください",
    statusWaiting: "お呼び出しまでお待ちください",
    statusSeated: "ご案内済みです",
    statusSeatedBody: "スタッフの案内に従ってお進みください。",
    statusWalked: "受付を取り消しました",
    statusWalkedBody: "またのご来店をお待ちしております。",
    keepOpen: "この画面は自動で更新されます。閉じずにお待ちください。",
    leave: "受付を取り消す",
    leaveConfirm: "順番待ちを取り消しますか？",
    leaveYes: "取り消す",
    leaveNo: "戻る",
    poweredBy: "Powered by ifasto",
  },
  qrSign: {
    title: "店頭QRサイン",
    scanToJoin: "スキャンして順番待ちに参加",
    subtitle: "お並びの前に、スマートフォンで受付できます",
    print: "印刷する",
    rotate: "QRを再発行",
    rotateConfirm: "再発行すると、印刷済みのQRは使えなくなります。続けますか？",
    rotated: "新しいQRを発行しました。サインを印刷し直してください。",
    backToBoard: "← ボードへ戻る",
    urlLabel: "受付URL",
  },
};

export const en: Dict = {
  common: {
    loading: "Loading…",
    signOut: "Sign out",
    cancel: "Cancel",
    save: "Save",
    saving: "Saving…",
    close: "Close",
    optional: "optional",
    minutes: (n) => `${n} min`,
    partyOf: (n) => `party of ${n}`,
    roleLabel: (r) => r,
  },

  login: {
    subtitle: "Restaurant dashboard",
    email: "Email",
    password: "Password",
    signIn: "Sign in",
    signingIn: "Signing in…",
    badCredentials: "Incorrect email or password.",
    failed: (s, m) => `Login failed (${s}): ${m}`,
    network: "Network error. Try again.",
    issuedNote: "Accounts are issued by ifasto. Contact",
    issuedContact: "for access.",
  },

  ops: {
    title: "ifasto · ops",
    signedInAs: (name) => `Signed in as ${name}`,
    live: "LIVE",
    offline: "OFFLINE",
    liveTooltip: "Live updates connected",
    offlineTooltip: "Reconnecting…",
    premiumOn: "PREMIUM ON — pause",
    premiumPaused: "PREMIUM PAUSED — resume",
    pauseTooltipOn: "Pause premium skip sales immediately",
    pauseTooltipPaused: "Resume premium skip sales",
    ownerOnly: "Owner/manager only",
    caps: "Caps",
    help: "Help",
    qrSign: "Door QR",
    history: "History",
    survey: "Survey",
    account: "Account",

    tileWaiting: "Waiting",
    tileRegular: "Regular",
    tilePremium: "Premium",
    tileMedianWait: "Median wait (today)",
    tileSeatedToday: "Seated today",
    tilePremiumToday: "Premium ¥ today",

    quickAdd: "Quick add",
    quickAddDetail: "+ details",
    ticket: (n) => `#${n}`,
    undo: "Undo",
    undoSeated: (ticket) => `Seated ${ticket}`,
    undoWalked: (ticket) => `Marked ${ticket} walked away`,
    errUndo: "Could not undo.",
    offlineBanner: "Offline. Record on paper and enter entries when it recovers.",

    nextUp: "Next up",
    queueEmpty: "Queue is empty",
    walkIn: "Walk-in",
    premiumChip: "PREMIUM",
    addParty: "+ Add party",
    seatNext: "Seat next",

    colPremium: "Premium",
    colRegular: "Regular",
    emptyPremium: "No premium parties.",
    emptyRegular: "No regular parties.",
    waited: (m) => `waited ${m} min`,
    seat: "Seat",
    walk: "Walk",

    errSeat: "Could not seat that party.",
    errWalk: "Could not mark that party as walked away.",
    errPause: "Could not update premium state.",
    errQueueLoad: (s, m) => `Queue load failed (${s}): ${m}`,
    errQueueNetwork: "Could not reach the queue service.",
    errAdd: "Could not add the party.",
  },

  modal: {
    title: "Add to queue",
    partySize: "Party size",
    type: "Type",
    typeRegular: "Regular",
    typePremium: "Premium (skip)",
    name: "Name (optional)",
    phone: "Phone (optional)",
    notes: "Notes (optional)",
    fetchingQuote: "Fetching live quote…",
    engineQuote: "Engine quote:",
    quoteWait: (m) => `~${m} min wait`,
    quoteLocked: "locked 5 min",
    noQuote: (reason) => `No live quote (${reason}) — enter price manually`,
    skipPrice: "Skip price (¥ charged to guest)",
    submit: "Add to queue",
    submitting: "Adding…",
  },

  caps: {
    maxShare: "Max premium share (%)",
    ceiling: "Price ceiling (¥)",
    maxEligible: "Max party size eligible",
    largeCap: "Large-party skips / service",
    saveCaps: "Save caps",
    errSave: "Could not save caps.",
  },

  tile: {
    label: (p) => `Skip price · party ${p}`,
    fetching: "fetching",
    liveSub: "live",
    waitSub: (m) => `~${m} min wait`,
    paused: "paused",
    capReached: "cap reached",
    outOfHours: "outside service hours",
    engineOffline: "engine offline",
    offline: "offline",
    unavailable: "unavailable",
  },

  history: {
    title: "ifasto · history",
    subtitle: (d) => `Last ${d} days · JST`,
    backToBoard: "← Live board",
    seated7: "Seated (7d)",
    walked7: "Walk-aways (7d)",
    premiumSold7: "Premium sold (7d)",
    premiumRevenue7: "Premium ¥ (7d)",
    medianWait7: "Median wait (7d)",
    newBadge: "new",
    wowSuffix: " min WoW",
    colDate: "Date",
    colSeated: "Seated",
    colWalked: "Walked",
    colPremium: "Premium",
    colPremiumRevenue: "Premium ¥",
    colMedianWait: "Median wait",
    colPremiumSaves: "Premium saves",
    spike: "SPIKE",
    spikeTooltip:
      "Walk-away spike vs window average — check whether premium pressure is hurting the regular line",
    empty: "No activity in the window yet. Rows appear as soon as the queue is used.",
    errLoad: "Could not load the report.",
    min: "min",
  },

  account: {
    title: "Account",
    backToBoard: "← Live board",
    changePassword: "Change password",
    newPassword: "New password (min 8 characters)",
    repeatPassword: "Repeat new password",
    tooShort: "Password must be at least 8 characters.",
    mismatch: "Passwords do not match.",
    updated: "Password updated. Use it on your next sign-in.",
    failed: (s) => `Could not update password (${s}).`,
    network: "Network error. Try again.",
    update: "Update password",
    updating: "Saving…",
    language: "Language",
  },
  guest: {
    joinTitle: "Join the queue",
    waitingNow: (n) => `${n} ${n === 1 ? "party" : "parties"} waiting now`,
    partySize: "How many people?",
    people: (n) => `${n}`,
    join: "Join queue",
    joining: "Joining…",
    queueFull: "The queue is full right now. Please see the staff at the door.",
    tooMany: "Too many joins from this device. Please try again later.",
    unknownVenue: "This QR code is not valid. Please see the staff at the door.",
    network: "Network error. Please try again.",
    returnToTicket: "View your ticket",
    ticketTitle: "Your ticket",
    ticketNo: (n) => `No. ${n}`,
    partiesAhead: (n) => `${n} ${n === 1 ? "party" : "parties"} ahead`,
    estWait: (m) => `About ${m} min`,
    waitUnknown: "Ask the staff for the current wait",
    statusWaiting: "Please wait to be called",
    statusSeated: "You have been seated",
    statusSeatedBody: "Please follow the staff's directions.",
    statusWalked: "Your spot has been cancelled",
    statusWalkedBody: "We hope to see you again.",
    keepOpen: "This page updates automatically. Keep it open.",
    leave: "Leave the queue",
    leaveConfirm: "Leave the queue and give up your spot?",
    leaveYes: "Leave",
    leaveNo: "Stay",
    poweredBy: "Powered by ifasto",
  },
  qrSign: {
    title: "Door QR sign",
    scanToJoin: "Scan to join the queue",
    subtitle: "Join from your phone before lining up",
    print: "Print",
    rotate: "Rotate QR",
    rotateConfirm: "Rotating invalidates the printed QR immediately. Continue?",
    rotated: "New QR issued. Reprint the sign.",
    backToBoard: "← Live board",
    urlLabel: "Join URL",
  },
};

export const DICTS: Record<Locale, Dict> = { ja, en };
