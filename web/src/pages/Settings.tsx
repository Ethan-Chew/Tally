import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { Icon } from "../components/Icon";
import { ErrorNote, Field, PageSkeleton } from "../components/ui";
import { useAction, useMe } from "../hooks";
import { cx } from "../lib";
import { getTheme, setTheme, type Theme } from "../theme";

interface System {
  database: { host: string; port: string; name: string; user: string; local: boolean; size: number; version: string };
  counts: { accounts: number; transactions: number; entries: number };
  backups: { dir: string; mirror: string | null; keep: number; count: number; latest: { name: string; size: number; modified: string }[] };
}

const size = (b: number) => (b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);
const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card">
      <div className="card-head"><h2 className="section-title">{title}</h2></div>
      <div className="card-body">{children}</div>
    </section>
  );
}

function LinkRow({ to, icon, title }: { to: string; icon: string; title: string }) {
  return (
    <Link to={to} className="flex items-center gap-4 px-5 py-4 transition hover:bg-soft sm:px-7">
      <span className="icon-circle"><Icon name={icon} /></span>
      <span className="flex-1 text-[14px] font-medium">{title}</span>
      <Icon name="chevronRight" className="h-4 w-4 text-zinc-400" />
    </Link>
  );
}

export default function Settings() {
  const { data: me } = useMe();
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [currency, setCurrency] = useState("");
  const [saved, setSaved] = useState(false);
  const [theme, setThemeState] = useState<Theme>(getTheme());

  const system = useQuery({ queryKey: ["system"], queryFn: () => api<System>("/api/system") });
  const backup = useAction(() => api<{ file?: string }>("/api/system/backup", { method: "POST" }));
  const profile = useAction(() => api("/api/me", { method: "PATCH", body: { first_name: first, last_name: last, currency } }), () => setSaved(true));
  useEffect(() => { if (me) { setFirst(me.first_name ?? ""); setLast(me.last_name ?? ""); setCurrency(me.currency); } }, [me]);
  if (!me) return <PageSkeleton />;
  const sys = system.data;

  const themes: { v: Theme; label: string; icon: string }[] = [{ v: "light", label: "Light", icon: "sun" }, { v: "dark", label: "Dark", icon: "moon" }, { v: "system", label: "System", icon: "monitor" }];

  return (
    <div className="max-w-2xl space-y-8 sm:space-y-10">
      <h1 className="page-title">Settings</h1>

      <Section title="Appearance">
        <div className="grid grid-cols-3 gap-3">
          {themes.map((t) => (
            <button key={t.v} onClick={() => { setTheme(t.v); setThemeState(t.v); }} aria-pressed={theme === t.v}
              className={cx("flex flex-col items-center gap-2 rounded-2xl border px-3 py-4 text-[13px] font-medium transition", theme === t.v ? "border-accent bg-tint text-accent" : "border-zinc-200 text-zinc-600 hover:bg-soft")}>
              <Icon name={t.icon} className="h-5 w-5" />{t.label}
            </button>
          ))}
        </div>
      </Section>

      <section className="card overflow-hidden">
        <div className="card-head"><h2 className="section-title">Tools</h2></div>
        <div className="divide-y divide-zinc-100">
          <LinkRow to="/settings/import" icon="upload" title="Import transactions (CSV)" />
          <LinkRow to="/settings/categories" icon="categories" title="Categories, merchants & tags" />
        </div>
      </section>

      <Section title="Data">
        {!sys ? <div className="skeleton h-24 w-full" /> : (
          <div className="space-y-6">
            <div className="flex items-start gap-4">
              <span className="icon-circle"><Icon name="database" /></span>
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-medium">PostgreSQL · {sys.database.name}</div>
                <div className="muted mt-0.5 break-all text-[13px]">{sys.database.local ? "This computer" : "Hosted"} · {sys.database.host}:{sys.database.port} · {size(sys.database.size)}</div>
                <div className="muted mt-0.5 text-xs">{sys.counts.accounts} accounts · {sys.counts.transactions.toLocaleString()} transactions</div>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <span className="icon-circle"><Icon name="shield" /></span>
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-medium">{sys.backups.latest[0] ? `Last backup ${ago(sys.backups.latest[0].modified)}` : "No backups yet"}</div>
                <div className="muted mt-0.5 break-all text-[13px]">{sys.backups.dir}{sys.backups.mirror ? ` + ${sys.backups.mirror}` : ""}</div>
                {sys.backups.latest[0] && <div className="muted mt-0.5 text-xs">{sys.backups.count} saved · latest {size(sys.backups.latest[0].size)}</div>}
              </div>
              <button className="btn btn-primary shrink-0" disabled={backup.isPending} onClick={() => backup.mutate(undefined, { onSuccess: () => system.refetch() })}>
                {backup.isPending ? "Backing up…" : "Back up now"}
              </button>
            </div>
            <ErrorNote error={backup.error} />
            <p className="muted text-xs">Schedule automatic backups, add a second folder, or move the database: see docs/DATABASE.md.</p>
          </div>
        )}
      </Section>

      <form className="card" onSubmit={(e: FormEvent) => { e.preventDefault(); setSaved(false); profile.mutate(); }}>
        <div className="card-head"><h2 className="section-title">Profile</h2></div>
        <div className="card-body space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <Field label="First name"><input className="input" value={first} onChange={(e) => setFirst(e.target.value)} /></Field>
            <Field label="Last name"><input className="input" value={last} onChange={(e) => setLast(e.target.value)} /></Field>
          </div>
          <Field label="Home currency"><input className="input w-28 uppercase" maxLength={3} minLength={3} required value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} /></Field>
          <ErrorNote error={profile.error} />
          <div className="flex items-center gap-3"><button className="btn btn-primary" disabled={profile.isPending}>Save</button>{saved && <span className="text-sm text-emerald-600">Saved</span>}</div>
        </div>
      </form>
    </div>
  );
}
