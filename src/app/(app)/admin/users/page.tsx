import { Avatar, PageHead, StatCard } from "@/components/ui";
import { requireAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { isAdminClientConfigured } from "@/lib/supabase/admin";
import { formatDateTime } from "@/lib/domain/tickets";
import { CreateUserForm } from "./create-user-form";
import { UserRow } from "./user-row";

export const metadata = { title: "Kelola Pengguna" };

export default async function AdminUsersPage() {
  const session = await requireAdmin();
  const supabase = await createClient();

  const { data: profiles } = await supabase
    .from("profiles")
    .select("*")
    .order("created_at", { ascending: false });

  const rows = profiles ?? [];
  const configured = isAdminClientConfigured();

  const count = (role: string) => rows.filter((p) => p.role === role).length;

  return (
    <>
      <PageHead
        title="Kelola Pengguna"
        sub="Buat akun, atur role, dan nonaktifkan akses."
      />

      <div className="grid">
        <StatCard title="Total Pengguna" value={rows.length} note="Semua role" />
        <StatCard title="Pengguna" value={count("user")} note="Akses dashboard pelanggan" />
        <StatCard title="Admin" value={count("admin")} note="Akses penuh back office" />
        <StatCard
          title="Nonaktif"
          value={rows.filter((p) => !p.is_active).length}
          note="Akses dicabut sementara"
        />
      </div>

      <div className="split mt-3">
        <section className="card">
          <div className="card__head">
            <h2 className="card__title">Daftar pengguna</h2>
            <span className="chip">{rows.length} akun</span>
          </div>

          <div className="tbl__wrap mt-2">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Pengguna</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Terdaftar</th>
                  <th aria-label="Tindakan" />
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <div className="row row--center">
                        <Avatar name={p.full_name} tint={p.avatar_tint} size="sm" />
                        <div>
                          <p className="pitem__name">{p.full_name}</p>
                          <p className="pitem__due">{p.email}</p>
                        </div>
                      </div>
                    </td>
                    <td>
                      <UserRow
                        userId={p.id}
                        role={p.role}
                        isActive={p.is_active}
                        isSelf={p.id === session.userId}
                        canProvision={configured}
                        variant="role"
                      />
                    </td>
                    <td>
                      <UserRow
                        userId={p.id}
                        role={p.role}
                        isActive={p.is_active}
                        isSelf={p.id === session.userId}
                        canProvision={configured}
                        variant="status"
                      />
                    </td>
                    <td className="copy" style={{ fontSize: 12.5 }}>
                      {formatDateTime(p.created_at)}
                    </td>
                    <td>
                      <UserRow
                        userId={p.id}
                        role={p.role}
                        isActive={p.is_active}
                        isSelf={p.id === session.userId}
                        canProvision={configured}
                        variant="password"
                      />
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={5}>
                      <p className="empty">Belum ada pengguna.</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="side">
          <CreateUserForm configured={configured} />

          <section className="card">
            <h2 className="card__title">Peran &amp; kewenangan</h2>
            <dl className="dl mt-2">
              <div>
                <dt>Pengguna</dt>
                <dd>Ajukan &amp; validasi tiket</dd>
              </div>
              <div>
                <dt>Admin</dt>
                <dd>Akses penuh back office &amp; kelola akun</dd>
              </div>
            </dl>
          </section>
        </aside>
      </div>
    </>
  );
}
