import { lazy, Suspense, useEffect, useState } from "react";
import { Link, NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { ApiError } from "./api";
import { useMe } from "./hooks";
import { Icon } from "./components/Icon";
import { PageSkeleton } from "./components/ui";
import { isHidden, setHidden } from "./privacy";
import { isDark, setTheme } from "./theme";
import { cx } from "./lib";

// One chunk per page (recharts only loads with the pages that draw charts).
const loaders = {
  "/": () => import("./pages/Dashboard"),
  "/accounts": () => import("./pages/Accounts"),
  "/accounts/:id": () => import("./pages/AccountDetail"),
  "/transactions": () => import("./pages/Transactions"),
  "/calendar": () => import("./pages/Calendar"),
  "/budgets": () => import("./pages/Budgets"),
  "/cashflow": () => import("./pages/CashFlow"),
  "/reports": () => import("./pages/Reports"),
  "/recurring": () => import("./pages/Recurring"),
  "/settings": () => import("./pages/Settings"),
  "/settings/import": () => import("./pages/Import"),
  "/settings/categories": () => import("./pages/Manage"),
} as const;
const pages = Object.fromEntries(Object.entries(loaders).map(([k, l]) => [k, lazy(l)])) as unknown as Record<keyof typeof loaders, React.ComponentType>;

const NAV = [
  { to: "/", label: "Home", icon: "home", end: true },
  { to: "/accounts", label: "Accounts", icon: "accounts" },
  { to: "/transactions", label: "Activity", full: "Transactions", icon: "transactions" },
  { to: "/calendar", label: "Calendar", icon: "calendar" },
  { to: "/budgets", label: "Budgets", icon: "budgets" },
  { to: "/cashflow", label: "Cash flow", icon: "trend", desktopOnly: true },
  { to: "/reports", label: "Reports", icon: "budgets", desktopOnly: true },
  { to: "/recurring", label: "Recurring", icon: "repeat", desktopOnly: true }, // phones reach it from the Calendar page: the tab bar is full
  { to: "/settings", label: "Settings", icon: "settings" },
] as { to: string; label: string; full?: string; icon: string; end?: boolean; desktopOnly?: boolean }[];

const warm = (to: string) => loaders[to as keyof typeof loaders]?.();

export default function App() {
  const me = useMe();
  const loc = useLocation();
  const [, bump] = useState(0); // re-render the whole tree when the privacy flag flips
  const hidden = isHidden();
  const toggleHidden = () => { setHidden(!isHidden()); bump((n) => n + 1); };
  const dark = isDark();
  const toggleTheme = () => { setTheme(isDark() ? "light" : "dark"); bump((n) => n + 1); };

  // once the first page is up, fetch the other pages' code in the background
  useEffect(() => {
    const run = () => Object.values(loaders).forEach((l) => l());
    const w = window as any;
    const id = w.requestIdleCallback ? w.requestIdleCallback(run) : window.setTimeout(run, 800);
    return () => (w.cancelIdleCallback ? w.cancelIdleCallback(id) : clearTimeout(id));
  }, []);

  if (me.isLoading) return <div className="p-10"><PageSkeleton /></div>;
  if (me.error) {
    const msg = me.error instanceof ApiError ? me.error.message : "Can't reach the server";
    return <div className="mx-auto max-w-md p-10 text-center text-sm text-red-600">{msg}</div>;
  }
  const name = [me.data?.first_name, me.data?.last_name].filter(Boolean).join(" ");

  return (
    <div className="min-h-screen md:flex">
      {/* desktop sidebar */}
      <aside className="relative hidden shrink-0 border-r border-zinc-200/80 bg-white px-4 py-6 md:sticky md:top-0 md:block md:h-screen md:w-60">
        <Link to="/" className="mb-8 flex items-center gap-2.5 px-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-accent text-[13px] font-semibold text-white">m</div>
          <div className="text-[15px] font-semibold tracking-tight">Maybe</div>
        </Link>
        <nav className="flex flex-col gap-1" aria-label="Main">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} onMouseEnter={() => warm(n.to)}
              className={({ isActive }) => cx("flex items-center gap-3 whitespace-nowrap rounded-xl px-3 py-2.5 text-[13.5px] font-medium transition-colors", isActive ? "bg-tint text-accent" : "text-zinc-500 hover:bg-soft hover:text-zinc-900")}>
              <Icon name={n.icon} />{n.full ?? n.label}
            </NavLink>
          ))}
        </nav>
        <div className="absolute inset-x-4 bottom-6 flex items-center justify-between gap-2 border-t border-zinc-100 pt-5">
          <span className="truncate px-2 text-[13px] text-zinc-500">{name}</span>
          <div className="flex items-center gap-1.5">
            <button onClick={toggleTheme} className="icon-btn" aria-label={dark ? "Switch to light mode" : "Switch to dark mode"} title={dark ? "Light mode" : "Dark mode"}><Icon name={dark ? "sun" : "moon"} /></button>
            <button onClick={toggleHidden} className="icon-btn" aria-pressed={hidden} aria-label={hidden ? "Show amounts" : "Hide amounts"} title={hidden ? "Show amounts" : "Hide amounts"}><Icon name={hidden ? "eyeOff" : "eye"} /></button>
          </div>
        </div>
      </aside>

      {/* phone: slim top bar + bottom tabs */}
      <header className="sticky top-0 z-30 flex items-center gap-2.5 border-b border-zinc-200/80 bg-white/90 px-4 py-3 backdrop-blur md:hidden">
        <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-accent text-[13px] font-semibold text-white">m</div>
        <div className="text-[15px] font-semibold tracking-tight">Maybe</div>
        <div className="ml-auto flex items-center gap-1.5">
          <button onClick={toggleTheme} className="icon-btn" aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}><Icon name={dark ? "sun" : "moon"} /></button>
          <button onClick={toggleHidden} className="icon-btn" aria-pressed={hidden} aria-label={hidden ? "Show amounts" : "Hide amounts"}><Icon name={hidden ? "eyeOff" : "eye"} /></button>
        </div>
      </header>

      <main className="min-w-0 flex-1">
        <div className="mx-auto w-full max-w-6xl px-4 pb-28 pt-6 sm:px-6 md:px-10 md:py-10">
          <Suspense fallback={<PageSkeleton />}>
            <Routes>
              {(Object.keys(pages) as (keyof typeof loaders)[]).map((path) => {
                const Page = pages[path];
                return <Route key={path} path={path} element={<Page />} />;
              })}
              <Route path="/import" element={<Navigate to="/settings/import" replace />} />
              <Route path="/manage" element={<Navigate to="/settings/categories" replace />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </div>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-zinc-200/80 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden" aria-label="Main">
        {NAV.filter((n) => !n.desktopOnly).map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => cx("flex min-w-0 flex-1 flex-col items-center gap-1 px-0.5 pb-2 pt-2.5 text-[10px] font-medium", isActive ? "text-accent" : "text-zinc-400")}>
            <Icon name={n.icon} className="h-5 w-5" />{n.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
