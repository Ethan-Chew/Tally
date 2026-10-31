import { NavLink } from "react-router-dom";
import { cx } from "../lib";

const TABS = [
  { to: "/cashflow", label: "Cash Flow" },
  { to: "/reports", label: "Spending", end: true },
  { to: "/reports/income", label: "Income" },
];

/** The three views of the Reports area, drawn as underlined tabs. */
export function ReportTabs() {
  return (
    <nav className="-mt-2 flex gap-6 border-b border-zinc-200/80" aria-label="Reports">
      {TABS.map((t) => (
        <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => cx("-mb-px border-b-2 pb-3 text-sm font-medium transition-colors", isActive ? "border-accent text-accent" : "border-transparent text-zinc-500 hover:text-zinc-900")}>
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}
