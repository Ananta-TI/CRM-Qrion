// Hand-maintained mirror of supabase/migrations/0001_init.sql.
// Keep in sync when the schema changes.

export type UserRole = "user" | "admin";
export type UrgencyLevel = "Low" | "Medium" | "High" | "Critical";
export type TicketStatus = "Open" | "In Progress" | "Waiting Validation" | "Closed";
export type EscalationLevel = "L1" | "L2" | "L3";
export type MessageAuthorRole = "customer" | "agent" | "system";
export type MessageKind = "text" | "note" | "system" | "solution";
export type TicketCategory =
  | "Transaksi"
  | "Pembayaran"
  | "Pengiriman"
  | "Akun"
  | "Teknis"
  | "Produk"
  | "Lainnya";

export type Profile = {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  company: string | null;
  phone: string | null;
  avatar_tint: string | null;
  timezone: string | null;
  is_active: boolean;
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

export type SlaPolicy = {
  urgency: UrgencyLevel;
  level: EscalationLevel;
  response_minutes: number;
  resolve_minutes: number;
};

export type TicketKnowledge = {
  id: string;
  ticket_code: string;
  subject: string;
  description: string;
  category: TicketCategory;
  urgency: UrgencyLevel;
  status: TicketStatus;
  escalation_level: EscalationLevel;
  resolution_summary: string | null;
  tags: string[];
  csat_score: number | null;
  reopen_count: number;
  created_at: string;
  closed_at: string | null;
  sla_deadline: string | null;
  sla_breached: boolean;
  hours_to_close: number | null;
  customer_name: string;
  agent_name: string | null;
};

type Table<Row, Insert = Partial<Row>, Update = Partial<Row>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

type View<Row> = { Row: Row; Relationships: [] };

export type Database = {
  public: {
    Tables: {
      profiles: Table<Profile>;
      tickets: Table<Ticket>;
      messages: Table<Message>;
      ticket_events: Table<TicketEvent>;
      sla_policy: Table<SlaPolicy>;
    };
    Views: {
      ticket_knowledge: View<TicketKnowledge>;
    };
    Functions: {
      apply_sla: { Args: { p_ticket: string }; Returns: undefined };
      refresh_sla_breaches: { Args: Record<string, never>; Returns: number };
      current_role_name: { Args: Record<string, never>; Returns: UserRole };
      is_staff: { Args: Record<string, never>; Returns: boolean };
      is_admin: { Args: Record<string, never>; Returns: boolean };
      can_access_ticket: { Args: { p_ticket: string }; Returns: boolean };
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
