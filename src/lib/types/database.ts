// Hand-maintained mirror of supabase/migrations/0001_init.sql.
// Keep in sync when the schema changes.

export type UserRole = "user" | "admin";
export type UrgencyLevel = "Low" | "Medium" | "High" | "Critical";
export type TicketStatus = "Open" | "In Progress" | "Waiting Validation" | "Closed";
export type EscalationLevel = "L1" | "L2" | "L3";
export type MessageAuthorRole = "customer" | "agent" | "system";
export type MessageKind = "text" | "note" | "system" | "solution";
export type TicketCategory =
  | "Server"
  | "Teknis"
  | "Keuangan"
  | "Akun"
  | "Transaksi"
  | "Pembayaran"
  | "Pengiriman"
  | "Produk"
  | "Lainnya";

export type Profile = {
  id: string;
  email: string;
  username: string | null;
  full_name: string;
  role: UserRole;
  company: string | null;
  phone: string | null;
  avatar_tint: string | null;
  timezone: string | null;
  is_active: boolean;
  notifications_seen_at: string | null;
  created_at: string;
  updated_at: string;
};

export type Ticket = {
  id: string;
  ticket_code: string;
  customer_id: string;
  assignee_id: string | null;
  subject: string;
  description: string;
  category: TicketCategory;
  urgency: UrgencyLevel;
  status: TicketStatus;
  escalation_level: EscalationLevel;
  transaction_ref: string | null;
  transaction_date: string | null;
  transaction_amount: number | null;
  transaction_history: TransactionEntry[];
  attachments: Attachment[];
  sla_policy_minutes: number | null;
  sla_deadline: string | null;
  /** When the customer-wait clock started; null means the SLA is running. */
  sla_paused_at: string | null;
  /** Completed customer-wait minutes, excluded from SLA analytics. */
  sla_paused_minutes: number;
  first_response_at: string | null;
  resolved_at: string | null;
  closed_at: string | null;
  sla_breached: boolean;
  reopen_count: number;
  csat_score: number | null;
  csat_comment: string | null;
  csat_at: string | null;
  resolution_summary: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
};

export type TransactionEntry = {
  ref?: string;
  date?: string;
  amount?: number;
  status?: string;
  note?: string;
};

/** One uploaded file. `path` is the object key inside the storage bucket. */
export type Attachment = {
  path: string;
  name: string;
  mime: string;
  size: number;
};

export type Message = {
  id: string;
  ticket_id: string;
  author_id: string | null;
  author_role: MessageAuthorRole;
  kind: MessageKind;
  body: string;
  attachments: Attachment[];
  is_read: boolean;
  created_at: string;
};

export type TicketEvent = {
  id: string;
  ticket_id: string;
  actor_id: string | null;
  event_type: string;
  from_value: string | null;
  to_value: string | null;
  note: string | null;
  created_at: string;
};

/** Account-level notification shown in the same bell as ticket activity. */
export type Notification = {
  id: string;
  recipient_id: string;
  actor_id: string | null;
  kind: string;
  title: string;
  body: string | null;
  href: string | null;
  read_at: string | null;
  created_at: string;
};

export type SlaPolicy = {
  urgency: UrgencyLevel;
  level: EscalationLevel;
  response_minutes: number;
  resolve_minutes: number;
};

export type Programmer = {
  id: string;
  full_name: string;
  avatar_tint: string | null;
};

type Table<Row, Insert = Partial<Row>, Update = Partial<Row>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      profiles: Table<Profile>;
      tickets: Table<Ticket>;
      messages: Table<Message>;
      ticket_events: Table<TicketEvent>;
      notifications: Table<Notification>;
      sla_policy: Table<SlaPolicy>;
    };
    Views: Record<string, never>;
    Functions: {
      apply_sla: { Args: { p_ticket: string }; Returns: undefined };
      refresh_sla_breaches: { Args: Record<string, never>; Returns: number };
      pause_ticket_sla: { Args: { p_ticket: string }; Returns: undefined };
      resume_ticket_sla: { Args: { p_ticket: string }; Returns: undefined };
      auto_close_stale_tickets: { Args: { p_days: number }; Returns: number };
      current_role_name: { Args: Record<string, never>; Returns: UserRole };
      is_staff: { Args: Record<string, never>; Returns: boolean };
      is_admin: { Args: Record<string, never>; Returns: boolean };
      is_programmer: { Args: { p_user: string }; Returns: boolean };
      list_programmers: { Args: Record<string, never>; Returns: Programmer[] };
      can_access_ticket: { Args: { p_ticket: string }; Returns: boolean };
      email_for_username: { Args: { p_username: string }; Returns: string | null };
      notify_programmers: {
        Args: {
          p_kind: string;
          p_title: string;
          p_body?: string | null;
          p_href?: string | null;
        };
        Returns: number;
      };
      get_my_profile: { Args: Record<string, never>; Returns: Profile[] };
      get_nav_counts: {
        Args: Record<string, never>;
        Returns: { customer_active: number; staff_open: number }[];
      };
    };
    Enums: {
      user_role: UserRole;
      urgency_level: UrgencyLevel;
      ticket_status: TicketStatus;
      escalation_level: EscalationLevel;
      message_author_role: MessageAuthorRole;
      message_kind: MessageKind;
    };
    CompositeTypes: Record<string, never>;
  };
};
