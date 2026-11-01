import { useEffect, useRef, type ReactNode } from "react";
import { cx, moneyParts } from "../lib";
import { Icon, categoryIconName } from "./Icon";

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-[8vh]" onMouseDown={onClose}>
      <div className={cx("card w-full p-5", wide ? "max-w-2xl" : "max-w-md")} role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <button className="btn btn-ghost !px-2" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="muted mt-1 block text-xs">{hint}</span>}
    </label>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  return <p className="rounded-lg bg-red-50 td text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{(error as Error).message}</p>;
}

export function Spinner() {
  return <div className="muted p-10 text-center text-sm">Loading…</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="muted px-6 py-12 text-center text-sm">{children}</div>;
}

export function Progress({ value, max, over }: { value: number; max: number; over?: boolean }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0; // nothing to measure against -> empty track
  const isOver = over ?? (max > 0 && value > max);
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-100">
      <div className={cx("h-full rounded-full", isOver ? "bg-red-500" : "bg-accent")} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Pills<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-full bg-soft p-1">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cx("whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-medium transition", value === o.value ? "bg-white text-accent shadow-sm" : "text-zinc-500 hover:text-zinc-900")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Dot({ color }: { color: string | null }) {
  return <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color ?? "#9ca3af" }} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("skeleton", className)} />;
}

export function PageSkeleton() {
  return (
    <div className="space-y-8" aria-busy="true" aria-label="Loading">
      <div><Skeleton className="h-8 w-48" /><Skeleton className="mt-3 h-4 w-64" /></div>
      <Skeleton className="h-72 w-full !rounded-2xl" />
      <div className="grid gap-6 lg:grid-cols-2"><Skeleton className="h-52 !rounded-2xl" /><Skeleton className="h-52 !rounded-2xl" /></div>
    </div>
  );
}

/** Calls `onVisible` when scrolled near the bottom. Used for load-as-you-scroll lists. */
export function LoadMore({ onVisible, loading, hasMore }: { onVisible: () => void; loading: boolean; hasMore: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !hasMore) return;
    const io = new IntersectionObserver((e) => e[0]?.isIntersecting && !loading && onVisible(), { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
  }, [onVisible, loading, hasMore]);
  if (!hasMore) return null;
  return (
    <div ref={ref} className="muted flex justify-center border-t border-zinc-100 py-5 text-[13px]">
      {loading ? "Loading more…" : <button className="btn" onClick={onVisible}>Load more</button>}
    </div>
  );
}

/** Hero balance: the cents are set smaller, like a bank statement. */
export function BigMoney({ value, currency, className }: { value: number; currency: string; className?: string }) {
  const { main, cents } = moneyParts(value, currency);
  return (
    <span className={cx("tabular-nums tracking-tight", className)}>
      {main}
      {cents && <span className="text-[0.55em] font-medium text-zinc-400">{cents}</span>}
    </span>
  );
}

/** Category icon in a circle tinted with the category colour. `transfer` shows a swap icon. */
export function CatBadge({ name, color, icon, transfer, size = "md" }: { name: string | null; color: string | null; icon?: string | null; transfer?: boolean; size?: "xs" | "sm" | "md" }) {
  const box = size === "xs" ? "h-6 w-6" : size === "sm" ? "h-8 w-8" : "h-10 w-10";
  const glyph = size === "xs" ? "h-3.5 w-3.5" : size === "sm" ? "h-4 w-4" : "h-[18px] w-[18px]";
  if (transfer) return <span className={cx("flex shrink-0 items-center justify-center rounded-full bg-soft text-zinc-500", box)}><Icon name="swap" className={glyph} /></span>;
  const c = color ?? "#9ca3af";
  return (
    <span className={cx("flex shrink-0 items-center justify-center rounded-full", box)} style={{ background: `${c}22`, color: c }} aria-hidden="true">
      <Icon name={categoryIconName(icon, name)} className={glyph} />
    </span>
  );
}

/** A tiny trend line with a dashed baseline at the starting value, like the account rows in Monarch. */
export function Sparkline({ values, good = true, className }: { values: number[] | null | undefined; good?: boolean; className?: string }) {
  if (!values || values.length < 2) return <div className={cx("h-8 w-28", className)} />;
  const w = 112, h = 32, pad = 3;
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const x = (i: number) => (i / (values.length - 1)) * w;
  const y = (v: number) => h - pad - ((v - min) / span) * (h - pad * 2);
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={cx("h-8 w-28", className)} aria-hidden="true">
      <line x1="0" x2={w} y1={y(values[0]!)} y2={y(values[0]!)} stroke="var(--chart-line)" strokeDasharray="3 3" />
      <path d={d} fill="none" stroke={good ? "#10b981" : "#ef4444"} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Keep only what can be part of a money amount: digits, one decimal point, at most 2 decimals, optionally a leading minus. */
export function cleanAmount(raw: string, allowNegative = false): string {
  const neg = allowNegative && raw.trim().startsWith("-");
  let t = raw.replace(/[^0-9.]/g, "");
  const dot = t.indexOf(".");
  if (dot >= 0) t = t.slice(0, dot + 1) + t.slice(dot + 1).replace(/\./g, "");
  let [int = "", dec] = t.split(".");
  int = int.replace(/^0+(?=\d)/, "").slice(0, 9);
  const out = dec === undefined ? int : `${int || "0"}.${dec.slice(0, 2)}`;
  return neg ? `-${out}` : out;
}

/** A number box that cannot hold anything but an amount: typing or pasting letters, symbols or a third decimal does nothing, and the phone shows the numeric keypad. */
export function MoneyInput({ value, onChange, onBlur, currency, allowNegative, large, invalid, autoFocus, label, id }: {
  value: string; onChange: (v: string) => void; onBlur?: () => void; currency?: string; allowNegative?: boolean; large?: boolean; invalid?: boolean; autoFocus?: boolean; label?: string; id?: string;
}) {
  const input = (
    <input
      id={id} type="text" inputMode="decimal" autoComplete="off" autoFocus={autoFocus} aria-label={label ?? "Amount"} aria-invalid={invalid || undefined} placeholder="0.00" value={value}
      onChange={(e) => onChange(cleanAmount(e.target.value, allowNegative))}
      onBlur={() => {
        const n = Number(value);
        if (value !== "" && Number.isFinite(n)) onChange(n.toFixed(2)); // 12.5 -> 12.50
        else if (value === "-" || value === ".") onChange("");
        onBlur?.();
      }}
      className={cx(
        "w-full min-w-0 bg-transparent tabular-nums outline-none placeholder:text-zinc-300",
        large ? "text-center text-[40px] font-semibold tracking-tight" : "text-[14px]",
      )}
    />
  );
  return (
    <div className={cx(
      "flex items-center gap-2 rounded-xl border bg-white transition focus-within:ring-4",
      large ? "justify-center px-4 py-3" : "h-10 px-3",
      invalid ? "border-red-400 focus-within:border-red-500 focus-within:ring-red-500/10" : "border-zinc-200 focus-within:border-accent focus-within:ring-accent/10",
    )}>
      {currency && <span className={cx("muted shrink-0 font-medium", large ? "text-lg" : "text-xs")}>{currency}</span>}
      {input}
    </div>
  );
}
