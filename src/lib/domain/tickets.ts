import type {
  EscalationLevel,
  TicketCategory,
  TicketStatus,
  UrgencyLevel,
} from "@/lib/types/database";

// -----------------------------------------------------------------------------
// Urgency
// -----------------------------------------------------------------------------
export const URGENCIES: UrgencyLevel[] = ["Low", "Medium", "High", "Critical"];

export const URGENCY_RANK: Record<UrgencyLevel, number> = {
  Critical: 4,
  High: 3,
  Medium: 2,
  Low: 1,
};

/** Fernly's palette: rose for danger, amber for warning, green for calm. */
export const URGENCY_STYLE: Record<
  UrgencyLevel,
  { label: string; pill: string; dot: string; bar: string }
> = {
  Critical: {
    label: "Critical",
    pill: "pill--crit",
    dot: "sw--crit",
    bar: "urgency--crit",
  },
  High: { label: "High", pill: "pill--high", dot: "sw--high", bar: "urgency--high" },
  Medium: {
    label: "Medium",
    pill: "pill--med",
    dot: "sw--med",
    bar: "urgency--med",
  },
  Low: { label: "Low", pill: "pill--low", dot: "sw--low", bar: "urgency--low" },
};

// -----------------------------------------------------------------------------
// Status machine
// -----------------------------------------------------------------------------
export const STATUSES: TicketStatus[] = [
  "Open",
  "In Progress",
  "Waiting Validation",
  "Closed",
];

/** A customer may bring a closed ticket back for this many days. */
export const REOPEN_WINDOW_DAYS = 7;

export const TICKET_CATEGORIES: TicketCategory[] = [
  "Server",
  "Teknis",
  "Keuangan",
  "Akun",
  "Transaksi",
  "Pembayaran",
  "Pengiriman",
  "Produk",
  "Lainnya",
];

/** True while the ticket is still inside its customer-reopen window. */
export function canCustomerReopen(
  closedAt: string | null | undefined,
  now = Date.now(),
): boolean {
  if (!closedAt) return false;
  const closed = new Date(closedAt).getTime();
  if (!Number.isFinite(closed)) return false;
  return now - closed <= REOPEN_WINDOW_DAYS * 86_400_000;
}

export const STATUS_STYLE: Record<TicketStatus, { pill: string; seg: string }> = {
  Open: { pill: "pill--open", seg: "seg--open" },
  "In Progress": { pill: "pill--prog", seg: "seg--prog" },
  "Waiting Validation": { pill: "pill--wait", seg: "seg--wait" },
  Closed: { pill: "pill--done", seg: "seg--done" },
};

/** Allowed transitions. The UI reads this; the server action enforces it. */
export const STATUS_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  Open: ["In Progress", "Closed"],
  "In Progress": ["Waiting Validation", "Closed"],
  "Waiting Validation": ["Closed", "In Progress"],
  Closed: ["In Progress"],
};

export function canTransition(from: TicketStatus, to: TicketStatus): boolean {
  return STATUS_TRANSITIONS[from].includes(to);
}

/** The escalation ladder is retained only for the SLA policy matrix. */

// -----------------------------------------------------------------------------
// SLA
// -----------------------------------------------------------------------------
/**
 * Client-side mirror of the sla_policy table. The database is authoritative —
 * this is used to preview a deadline before the row exists, and to render
 * policy documentation. Keep the values aligned with 0001_init.sql.
 *
 * The level axis is retained because the DB trigger still derives the SLA from
 * `escalation_level`; the UI no longer exposes escalation actions.
 */
export const SLA_POLICY: Record<
  EscalationLevel,
  Record<UrgencyLevel, { response: number; resolve: number }>
> = {
  L1: {
    Critical: { response: 15, resolve: 240 },
    High: { response: 30, resolve: 480 },
    Medium: { response: 60, resolve: 1440 },
    Low: { response: 240, resolve: 4320 },
  },
  L2: {
    Critical: { response: 10, resolve: 120 },
    High: { response: 20, resolve: 240 },
    Medium: { response: 45, resolve: 720 },
    Low: { response: 120, resolve: 2880 },
  },
  L3: {
    Critical: { response: 5, resolve: 60 },
    High: { response: 15, resolve: 180 },
    Medium: { response: 30, resolve: 480 },
    Low: { response: 60, resolve: 1440 },
  },
};

export function slaTarget(
  urgency: UrgencyLevel,
  level: EscalationLevel,
): { response: number; resolve: number } {
  return SLA_POLICY[level][urgency];
}

export type SlaState = {
  /** "ok" | "soon" | "breached" | "met" | "paused" */
  tone: "ok" | "soon" | "breached" | "met" | "paused";
  label: string;
  /** Percentage of the SLA window consumed, clamped 0..100. */
  used: number;
  hoursLeft: number;
};

/**
 * The SLA clock only runs while the ball is in the agent's court. `pausedAt`
 * freezes the meter at the moment the ticket started waiting on the customer;
 * `pausedMinutes` removes completed waiting periods from the elapsed time.
 */
export function slaState(input: {
  createdAt: string;
  deadline: string | null;
  status: TicketStatus;
  breached?: boolean;
  paused?: boolean;
  pausedAt?: string | null;
  pausedMinutes?: number;
}): SlaState {
  const {
    createdAt,
    deadline,
    status,
    breached,
    paused = false,
    pausedAt,
    pausedMinutes = 0,
  } = input;

  if (status === "Closed") {
    return { tone: "met", label: "Closed", used: 100, hoursLeft: 0 };
  }

  if (!deadline) {
    return { tone: "ok", label: "No SLA", used: 0, hoursLeft: 0 };
  }

  const start = new Date(createdAt).getTime();
  const end = new Date(deadline).getTime();
  const frozenAt = paused && pausedAt ? new Date(pausedAt).getTime() : Date.now();
  const now = Number.isFinite(frozenAt) ? frozenAt : Date.now();

  // The deadline has already been pushed out by every completed pause, so the
  // base window is the extended span minus those paused minutes. Without this,
  // the meter would understate how much of the target has actually been used.
  const pausedMs = Math.max(pausedMinutes, 0) * 60_000;
  const total = Math.max(end - start - pausedMs, 1);
  const elapsed = now - start - pausedMs;
  const used = Math.min(Math.max((elapsed / total) * 100, 0), 100);
  const hoursLeft = (end - now) / 3_600_000;

  if (breached || hoursLeft <= 0) {
    return {
      tone: "breached",
      label: `Lewat ${formatDuration(-hoursLeft)}`,
      used: 100,
      hoursLeft,
    };
  }

  if (paused) {
    return {
      tone: "paused",
      label: "Menunggu balasan pelanggan",
      used,
      hoursLeft,
    };
  }

  return {
    tone: hoursLeft <= total / 3_600_000 / 3 ? "soon" : "ok",
    label: `${formatDuration(hoursLeft)} lagi`,
    used,
    hoursLeft,
  };
}

// -----------------------------------------------------------------------------
// Formatting helpers (id-ID locale, matching the Fernly typography)
// -----------------------------------------------------------------------------
export function formatDuration(hours: number): string {
  const h = Math.abs(hours);
  if (h < 1) {
    const mins = Math.max(1, Math.round(h * 60));
    return `${mins} menit`;
  }
  if (h < 24) {
    return `${Math.round(h)} jam`;
  }
  const days = h / 24;
  return `${days < 10 ? days.toFixed(1) : Math.round(days)} hari`;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value);
}

/**
 * Strip the characters PostgREST treats as filter syntax before interpolating
 * a user's query into `.or(...)`. Without this, a comma or parenthesis can end
 * the intended `ilike` clause and inject another filter.
 *
 * This is a query-safety guard, not a relevance transform: spaces are kept so
 * multi-word searches still work.
 */
export function sanitizeSearchTerm(value: string): string {
  return value
    .replace(/[%,()*"\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function relativeTime(value: string): string {
  const diff = Date.now() - new Date(value).getTime();
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return "baru saja";
  if (mins < 60) return `${mins} menit lalu`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} jam lalu`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} hari lalu`;
  return formatDate(value);
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/** "Waiting Validation" -> "waiting-validation" for CSS hooks. */
export function slug(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "-");
}

// -----------------------------------------------------------------------------
// Triage heuristic
// -----------------------------------------------------------------------------

/** Keyword → category. First match wins, so order matters a little. */
const CATEGORY_KEYWORDS: [TicketCategory, string[]][] = [
  [
    "Server",
    [
      "server", "server down", "hosting", "vps", "database", "jaringan",
      "internet", "koneksi", "uptime", "outage", "downtime", "maintenance",
      "cloud", "backup", "domain", "dns", "ssl", "deploy", "production",
    ],
  ],
  [
    "Keuangan",
    [
      "keuangan", "finance", "gaji", "payroll", "anggaran", "budget",
      "laporan keuangan", "pajak", "reimbursement", "pengeluaran",
      "pemasukan", "kas", "akuntansi",
    ],
  ],
  [
    "Pembayaran",
    [
      "bayar", "pembayaran", "transfer", "invoice", "tagihan", "kartu kredit",
      "va ", "virtual account", "ewallet", "e-wallet", "gopay", "ovo", "dana",
      "qris", "cicilan", "charge", "tertagih", "refund", "dana kembali",
    ],
  ],
  [
    "Transaksi",
    [
      "transaksi", "order", "pesanan", "beli", "pembelian", "checkout",
      "keranjang", "cart", "voucher", "promo", "diskon", "kupon", "harga",
    ],
  ],
  [
    "Pengiriman",
    [
      "kirim", "pengiriman", "kurir", "ekspedisi", "resi", "paket", "barang",
      "alamat", "ongkir", "jne", "jnt", "sicepat", "anteraja", "belum sampai",
      "terlambat sampai", "salah alamat", "paket hilang",
    ],
  ],
  [
    "Akun",
    [
      "akun", "login", "masuk", "password", "sandi", "otp", "verifikasi",
      "email", "daftar", "registrasi", "profil", "dibajak", "diblokir",
      "lupa password", "tidak bisa masuk", "reset",
    ],
  ],
  [
    "Teknis",
    [
      "error", "bug", "aplikasi", "app", "website", "loading", "lemot",
      "crash", "gangguan", "sistem", "tidak bisa dibuka", "blank",
      "tampilan", "500",
    ],
  ],
  [
    "Produk",
    [
      "produk", "barang rusak", "cacat", "kualitas", "garansi", "salah kirim",
      "tidak sesuai", "kadaluarsa", "expired", "ukuran", "warna", "spesifikasi",
    ],
  ],
];

/**
 * Guesses the complaint's category from its wording when the employee left the
 * form on auto-detect. Falls back to "Lainnya".
 */
export function triageCategory(input: {
  subject: string;
  description: string;
}): TicketCategory {
  const text = `${input.subject} ${input.description}`.toLowerCase();

  let best: { category: TicketCategory; hits: number } = {
    category: "Lainnya",
    hits: 0,
  };

  for (const [category, keywords] of CATEGORY_KEYWORDS) {
    const hits = keywords.reduce(
      (n, k) => (text.includes(k) ? n + 1 : n),
      0,
    );
    if (hits > best.hits) best = { category, hits };
  }

  return best.category;
}

/**
 * Derives the initial priority from the complaint text.
 *
 * Keyword hits, category weight and the transaction value all nudge the
 * urgency up. Deliberately conservative: it only escalates above Medium when
 * there is real signal, so the SLA ladder stays meaningful.
 *
 * Shared by the server action (authoritative) and the new-ticket form (live
 * preview), so the two never disagree.
 */
export function triageUrgency(input: {
  subject: string;
  description: string;
  category?: string;
  amount?: number;
}): UrgencyLevel {
  const text = `${input.subject} ${input.description}`.toLowerCase();
  const category =
    input.category ?? triageCategory({ subject: input.subject, description: input.description });

  const critical = [
    "hilang", "dibobol", "penipuan", "fraud", "double charge",
    "tertagih dua kali", "saldo berkurang", "tidak bisa login",
    "akun dibajak", "data bocor", "urgent banget", "segera",
  ];
  const high = [
    "gagal", "error", "tidak bisa", "belum diterima", "terlambat",
    "komplain", "kecewa", "refund", "batal", "pending", "stuck",
  ];

  let score = 0;
  if (critical.some((k) => text.includes(k))) score += 3;
  if (high.some((k) => text.includes(k))) score += 1;

  if (
    category === "Pembayaran" ||
    category === "Transaksi" ||
    category === "Keuangan" ||
    category === "Server"
  ) {
    score += 1;
  }
  if ((input.amount ?? 0) >= 5_000_000) score += 2;
  else if ((input.amount ?? 0) >= 1_000_000) score += 1;

  if (text.includes("!!!")) score += 1;

  if (score >= 4) return "Critical";
  if (score >= 2) return "High";
  if (score >= 1) return "Medium";
  return "Low";
}
