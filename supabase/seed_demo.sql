-- =============================================================================
-- Qrion CRM — Optional demo seed
--
-- Run this AFTER 0001_init.sql, and only if you want the dashboards to have
-- something to show. It is safe to re-run: everything is deleted first.
--
-- Prerequisite: you must have at least one profile with role = 'admin' and one
-- with role = 'user'. Promote your own account to admin with:
--   update public.profiles set role = 'admin' where email = 'you@example.com';
-- and let a second account register on /register to act as the customer.
-- =============================================================================

do $$
declare
  v_admin  uuid;
  v_agent  uuid;
  v_cust   uuid;
  v_ticket uuid;
  v_code   text;
  i        int;
  v_urgency urgency_level;
  v_status  ticket_status;
  v_level   escalation_level;
  v_subject text;
  v_body    text;
  v_cat     text;
  v_topics  text[] := array[
    'Pembayaran gagal tapi saldo terpotong',
    'Pesanan belum diterima padahal sudah dibayar',
    'Tidak bisa masuk ke akun setelah ganti nomor',
    'Refund belum masuk ke rekening',
    'Aplikasi error saat checkout',
    'Tagihan muncul dua kali bulan ini',
    'Produk yang diterima tidak sesuai pesanan'
  ];
begin
  select id into v_admin from public.profiles where role = 'admin' limit 1;
  -- Only two roles exist now; fall back to the admin for the "staff" side.
  select id into v_agent from public.profiles where role = 'admin' limit 1;
  select id into v_cust  from public.profiles where role = 'user' limit 1;

  if v_admin is null then
    raise notice 'No admin profile found — skipping seed. Create an admin first.';
    return;
  end if;

  -- Start from a clean slate.
  delete from public.ticket_events;
  delete from public.messages;
  delete from public.tickets;

  for i in 1..24 loop
    v_subject := v_topics[1 + (i % array_length(v_topics, 1))];
    v_urgency := (array['Low','Medium','High','Critical'])[1 + (i % 4)]::urgency_level;
    v_status  := (array['Open','In Progress','Waiting Validation','Closed','Closed'])[1 + (i % 5)]::ticket_status;
    v_level   := (array['L1','L1','L1','L2','L3'])[1 + (i % 5)]::escalation_level;
    v_cat     := (array['Pembayaran','Pengiriman','Akun','Transaksi','Teknis'])[1 + (i % 5)];
    v_body    := format(
      'Saya mengalami kendala: %s. Kejadian ini sudah saya alami sejak %s hari lalu dan belum ada penyelesaian. Mohon dibantu segera.',
      lower(v_subject), (i % 5) + 1
    );

    insert into public.tickets (
      customer_id, assignee_id, subject, description, category,
      urgency, status, escalation_level, transaction_ref, transaction_date,
      transaction_amount, created_at, csat_score, csat_at, resolution_summary, tags
    ) values (
      coalesce(v_cust, v_admin),
      case when v_status = 'Open' then null else coalesce(v_agent, v_admin) end,
      v_subject,
      v_body,
      v_cat,
      v_urgency,
      v_status,
      v_level,
      format('INV-2026-%s', lpad(i::text, 5, '0')),
      (current_date - (i % 20)),
      (100000 + i * 37500),
      now() - make_interval(days => i, hours => (i % 12)),
      case when v_status = 'Closed' then 1 + (i % 4) else null end,
      case when v_status = 'Closed' then now() - make_interval(days => i) else null end,
      case when v_status = 'Closed'
        then format('Masalah %s diselesaikan dengan %s.', lower(v_cat), 'penyesuaian pada sisi sistem')
        else null
      end,
      array[lower(v_cat)]
    )
    returning id, ticket_code into v_ticket, v_code;

    -- A short conversation.
    insert into public.messages (ticket_id, author_id, author_role, kind, body, created_at)
    values (v_ticket, coalesce(v_cust, v_admin), 'customer', 'text', v_body, now() - make_interval(days => i, hours => 10));

    insert into public.messages (ticket_id, author_id, author_role, kind, body, created_at)
    values (v_ticket, null, 'system', 'system',
      format('Tiket %s diterima dengan prioritas %s.', v_code, v_urgency),
      now() - make_interval(days => i, hours => 10));

    if v_status <> 'Open' then
      insert into public.messages (ticket_id, author_id, author_role, kind, body, created_at)
      values (
        v_ticket, coalesce(v_agent, v_admin), 'agent', 'text',
        'Terima kasih atas laporannya. Kami sedang menelusuri riwayat transaksi Anda dan akan segera memberikan solusi.',
        now() - make_interval(days => i, hours => 6)
      );
    end if;

    if v_status in ('Waiting Validation','Closed') then
      insert into public.messages (ticket_id, author_id, author_role, kind, body, created_at)
      values (
        v_ticket, coalesce(v_agent, v_admin), 'agent', 'solution',
        'Kami sudah melakukan perbaikan pada sisi sistem. Mohon dicek kembali, dan konfirmasi bila sudah beres.',
        now() - make_interval(days => i, hours => 2)
      );
    end if;

    insert into public.ticket_events (ticket_id, actor_id, event_type, to_value, note, created_at)
    values (v_ticket, coalesce(v_cust, v_admin), 'created', 'Open', null, now() - make_interval(days => i, hours => 10));

    if v_status <> 'Open' then
      insert into public.ticket_events (ticket_id, actor_id, event_type, from_value, to_value, note, created_at)
      values (v_ticket, coalesce(v_agent, v_admin), 'status_changed', 'Open', v_status::text, null, now() - make_interval(days => i, hours => 3));
    end if;
  end loop;

  raise notice 'Seeded 24 demo tickets.';
end $$;

-- Recompute SLA breach flags for the generated rows.
select public.refresh_sla_breaches();
