import { Link } from "react-router-dom";
import { useState, type FormEvent } from "react";
import { api, type Category, type Named } from "../api";
import { Icon } from "../components/Icon";
import { CatBadge, Dot, Empty, ErrorNote, Field, Modal, Pills, Spinner } from "../components/ui";
import { useAction, useCategories, useMerchants, useTags } from "../hooks";

type Kind = "categories" | "merchants" | "tags";
const PALETTE = ["#eb5429", "#e99537", "#4da568", "#61c9ea", "#6471eb", "#805dee", "#df4e92", "#c92d58", "#db5a54", "#737373"];

export default function Manage() {
  const [kind, setKind] = useState<Kind>("categories");
  const cats = useCategories(), merchants = useMerchants(), tags = useTags();
  const [editing, setEditing] = useState<{ id?: string; name: string; color: string; classification?: "expense" | "income" } | null>(null);

  const rows: (Named | Category)[] | undefined = { categories: cats.data, merchants: merchants.data, tags: tags.data }[kind];
  const remove = useAction((id: string) => api(`/api/${kind}/${id}`, { method: "DELETE" }));
  const singular = { categories: "category", merchants: "merchant", tags: "tag" }[kind];

  return (
    <div className="space-y-8 sm:space-y-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><div className="flex items-center gap-3"><Link to="/settings" className="icon-btn" aria-label="Back to settings"><Icon name="chevronLeft" /></Link><h1 className="page-title">Categories</h1></div></div>
        <button className="btn btn-primary" onClick={() => setEditing({ name: "", color: PALETTE[kind === "tags" ? 4 : 1]!, classification: "expense" })}>+ New {singular}</button>
      </div>
      <Pills value={kind} onChange={setKind} options={[{ value: "categories", label: "Categories" }, { value: "merchants", label: "Merchants" }, { value: "tags", label: "Tags" }]} />
      <ErrorNote error={remove.error} />
      <section className="card overflow-hidden">
        {!rows ? <Spinner /> : rows.length === 0 ? <Empty>Nothing here yet.</Empty> : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-5 py-4 sm:px-7">
                {"lucide_icon" in r ? <CatBadge size="sm" name={r.name} color={r.color} icon={r.lucide_icon} /> : <Dot color={r.color} />}
                <span className="min-w-0 truncate font-medium">{r.name}</span>
                {"classification" in r && <span className="pill hidden bg-soft text-zinc-600 sm:inline-block">{r.classification}</span>}
                <span className="muted ml-auto shrink-0 text-xs tabular-nums">{r.usage}</span>
                <button className="icon-btn shrink-0" aria-label={`Edit ${r.name}`} title="Edit" onClick={() => setEditing({ id: r.id, name: r.name, color: r.color, classification: "classification" in r ? r.classification : undefined })}><Icon name="edit" /></button>
                <button className="icon-btn shrink-0 !bg-red-50 !text-red-600 hover:!bg-red-100" aria-label={`Delete ${r.name}`} title="Delete" disabled={remove.isPending} onClick={() => confirm(`Delete "${r.name}"? ${r.usage ? `It's used by ${r.usage} item(s); they'll simply lose this ${singular}.` : ""}`) && remove.mutate(r.id)}><Icon name="trash" /></button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {editing && <EditModal kind={kind} singular={singular} initial={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function EditModal({ kind, singular, initial, onClose }: { kind: Kind; singular: string; initial: { id?: string; name: string; color: string; classification?: "expense" | "income" }; onClose: () => void }) {
  const [name, setName] = useState(initial.name);
  const [color, setColor] = useState(initial.color);
  const [classification, setClassification] = useState(initial.classification ?? "expense");
  const save = useAction(() => {
    const body = kind === "categories" ? { name, color, classification } : { name, color };
    return initial.id ? api(`/api/${kind}/${initial.id}`, { method: "PATCH", body }) : api(`/api/${kind}`, { method: "POST", body });
  }, onClose);
  const submit = (e: FormEvent) => { e.preventDefault(); save.mutate(); };
  return (
    <Modal title={`${initial.id ? "Edit" : "New"} ${singular}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Name"><input className="input" required autoFocus value={name} onChange={(e) => setName(e.target.value)} /></Field>
        {kind === "categories" && (
          <Field label="Kind">
            <select className="input" value={classification} onChange={(e) => setClassification(e.target.value as "expense" | "income")}><option value="expense">Expense</option><option value="income">Income</option></select>
          </Field>
        )}
        <div>
          <span className="label">Color</span>
          <div className="flex flex-wrap items-center gap-2">
            {PALETTE.map((c) => (
              <button type="button" key={c} aria-label={c} onClick={() => setColor(c)} className="h-7 w-7 rounded-full ring-offset-2 dark:ring-offset-gray-900" style={{ background: c, boxShadow: color === c ? `0 0 0 2px ${c}` : undefined, outline: color === c ? "2px solid white" : undefined, outlineOffset: -4 }} />
            ))}
            <input type="color" aria-label="Custom color" value={color} onChange={(e) => setColor(e.target.value)} className="h-7 w-9 cursor-pointer rounded border-0 bg-transparent p-0" />
          </div>
        </div>
        <ErrorNote error={save.error} />
        <div className="flex justify-end gap-2"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={save.isPending}>Save</button></div>
      </form>
    </Modal>
  );
}
