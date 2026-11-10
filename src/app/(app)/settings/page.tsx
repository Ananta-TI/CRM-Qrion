import { Avatar, PageHead } from "@/components/ui";
import { requireSession } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/domain/tickets";
import { CredentialsForm } from "./credentials-form";
import { ProfileForm } from "./profile-form";

export const metadata = { title: "Pengaturan" };

export default async function SettingsPage() {
  const session = await requireSession();

  return (
    <>
      <PageHead title="Pengaturan" sub="Profil dan preferensi akun Anda." />

      <div className="split">
        <div className="stack">
          <section className="card">
            <div className="row row--center">
              <Avatar
                name={session.profile.full_name}
                tint={session.profile.avatar_tint}
                size="xl"
              />
              <div>
                <h2 className="card__title">Profil</h2>
                <p className="copy">Beginilah programmer melihat Anda di dalam tiket.</p>
              </div>
            </div>

            <hr className="hair" />

            <ProfileForm
              profile={{
                full_name: session.profile.full_name,
                company: session.profile.company,
                phone: session.profile.phone,
                timezone: session.profile.timezone,
              }}
            />
          </section>

          <CredentialsForm
            email={session.profile.email}
            username={session.profile.username}
          />
        </div>

        <aside className="side">
          <section className="card">
            <h2 className="card__title">Akun</h2>
            <dl className="dl mt-2">
              <div>
                <dt>Username</dt>
                <dd>
                  {session.profile.username
                    ? `@${session.profile.username}`
                    : "Belum diatur"}
                </dd>
              </div>
              <div>
                <dt>Email</dt>
                <dd>{session.profile.email}</dd>
              </div>
              <div>
                <dt>Role</dt>
                <dd>{session.profile.role === "admin" ? "Programmer" : "Pegawai"}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{session.profile.is_active ? "Aktif" : "Nonaktif"}</dd>
              </div>
              <div>
                <dt>Terdaftar</dt>
                <dd>{formatDateTime(session.profile.created_at)}</dd>
              </div>
            </dl>
          </section>

          <section className="card">
            <h2 className="card__title">Tips keamanan</h2>
            <p className="copy mt-1">
              Ganti password awal setelah masuk pertama kali. Setelah password
              diganti, semua perangkat lain otomatis dikeluarkan.
            </p>
          </section>
        </aside>
      </div>
    </>
  );
}
