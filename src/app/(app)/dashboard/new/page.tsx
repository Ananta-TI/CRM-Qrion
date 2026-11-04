import { PageHead } from "@/components/ui";
import { requireCustomer } from "@/lib/auth/session";
import { NewTicketForm } from "./new-ticket-form";

export const metadata = { title: "Ajukan Keluhan" };

export default async function NewTicketPage() {
  const session = await requireCustomer();

  return (
    <>
      <PageHead
        title="Ajukan Keluhan"
        sub="Sistem akan menentukan prioritas dan menetapkan target SLA secara otomatis."
      />
      <NewTicketForm customerName={session.profile.full_name} />
    </>
  );
}
