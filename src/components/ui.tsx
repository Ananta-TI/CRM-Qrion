import {
  STATUS_STYLE,
  URGENCY_STYLE,
  formatDate,
  formatDateTime,
  initials,
  slaState,
} from "@/lib/domain/tickets";
import type { TicketStatus, UrgencyLevel } from "@/lib/types/database";
import { IconStar } from "./icons";
import { PageHeadClient } from "./page-head-client";

// -----------------------------------------------------------------------------
// Pills
// -----------------------------------------------------------------------------
export function StatusPill({ status }: { status: TicketStatus }) {
  return (
    <span className={`pill ${STATUS_STYLE[status].pill}`}>
      <span
        className={`sw ${
          status === "Closed"
            ? "sw--done"
            : status === "In Progress"
              ? "sw--prog"
              : status === "Waiting Validation"
                ? "sw--high"
                : "sw--pend"
        }`}
      />
      {status}
    </span>
  );
}

export function UrgencyPill({ urgency }: { urgency: UrgencyLevel }) {
  const style = URGENCY_STYLE[urgency];
  return (
    <span className={`pill ${style.pill}`}>
      <span className={`sw ${style.dot}`} />
      {urgency}
    </span>
  );
}

export function CategoryTag({ category }: { category: string }) {
  return <span className="tag">{category}</span>;
}

// -----------------------------------------------------------------------------
// SLA indicator
// -----------------------------------------------------------------------------
export function SlaMeter({
  createdAt,
  deadline,
  status,
  breached,
  paused = false,
  pausedAt,
  pausedMinutes = 0,
  showWindow = true,
}: {
  createdAt: string;
  deadline: string | null;
  status: TicketStatus;
  breached?: boolean;
  paused?: boolean;
  pausedAt?: string | null;
  pausedMinutes?: number;
  showWindow?: boolean;
}) {
  const state = slaState({
    createdAt,
    deadline,
    status,
    breached,
    paused,
    pausedAt,
    pausedMinutes,
  });

  return (
    <div className="kcard__sla">
      <div className="sla-bar">
        <div
          className={`sla-bar__fill sla-bar__fill--${state.tone}`}
          style={{ width: `${Math.max(state.used, 3)}%` }}
        />
      </div>
      <div className={`sla-note sla-note--${state.tone}`}>
        <span>
          {state.tone === "breached"
            ? "SLA terlampaui"
            : state.tone === "met"
              ? "Selesai"
              : state.tone === "paused"
                ? "SLA dijeda"
                : "Sisa waktu SLA"}
        </span>
        <span>{state.label}</span>
      </div>
      {showWindow && deadline && (
        <div className="sla-note">
          <span>Target {formatDateTime(deadline)}</span>
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Avatar + rating
// -----------------------------------------------------------------------------
export function Avatar({
  name,
  tint,
  size = "md",
}: {
  name: string;
  tint?: string | null;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const cls = size === "md" ? "avatar" : `avatar avatar--${size}`;
  return (
    <span className={cls} style={tint ? { ["--av" as string]: tint } : undefined}>
      {initials(name)}
    </span>
  );
}

export function Rating({ score }: { score: number | null }) {
  if (!score) {
    return (
      <span className="rating rating--empty" title="Belum ada CSAT">
        {[1, 2, 3, 4, 5].map((i) => (
          <IconStar key={i} />
        ))}
      </span>
    );
  }
  return (
    <span className="rating" title={`CSAT ${score}/5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <IconStar
          key={i}
          style={i > score ? { color: "var(--hair)", fill: "none" } : undefined}
        />
      ))}
    </span>
  );
}

// -----------------------------------------------------------------------------
// Stat card
// -----------------------------------------------------------------------------
export function StatCard({
  title,
  value,
  href,
  trend,
  note,
}: {
  title: string;
  value: string | number;
  href?: string;
  trend?: string;
  note: string;
}) {
  return (
    <article className="card">
      <div className="stat__head">
        <h2 className="stat__title">{title}</h2>
        {href && (
          <a className="arrow" href={href} aria-label={`Buka ${title}`}>
            <svg viewBox="0 0 24 24" aria-hidden="true" width={17} height={17}>
              <path d="M7.5 16.5l9-9M9.5 7.5h7v7" />
            </svg>
          </a>
        )}
      </div>
      <p className="stat__num">{value}</p>
      <p className="stat__note">
        {trend && <span className="trend">{trend}</span>}
        {note}
      </p>
    </article>
  );
}

// -----------------------------------------------------------------------------
// Empty + page head
// -----------------------------------------------------------------------------
export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="empty">{children}</p>;
}

/**
 * Pages stay Server Components; `PageHead` is the client bridge that publishes
 * { title, crumbs, actions } to the persistent header. It renders nothing where
 * it sits — the header itself lives in the shell and never remounts.
 */
export function PageHead({
  title,
  sub,
  crumbs,
  children,
}: {
  title: string;
  sub?: string;
  crumbs?: { label: string; href?: string }[];
  children?: React.ReactNode;
}) {
  return <PageHeadClient title={title} sub={sub} crumbs={crumbs} actions={children} />;
}

export { formatDate, formatDateTime };
