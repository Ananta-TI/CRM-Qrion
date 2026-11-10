import { PageHead } from "@/components/ui";
import { requireCustomer } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { NewTicketForm } from "./new-ticket-form";

export const metadata = { title: "Ajukan Keluhan" };

export default async function NewTicketPage() {
  const session = await requireCustomer();

  // The directory is a SECURITY DEFINER RPC because employees cannot read
  // other profiles directly. If 0010 has not been applied yet, the picker
  // simply falls back to the shared "All" target.
  const supabase = await createClient();
  const { data: programmers } = await supabase.rpc("list_programmers");

  return (
    <>
      <PageHead
        title="Ajukan Keluhan"
        sub="Pilih programmer tujuan; sistem menentukan prioritas dan target SLA secara otomatis."
      />
      <NewTicketForm
        customerName={session.profile.full_name}
        programmers={programmers ?? []}
      />
    </>
  );
}
