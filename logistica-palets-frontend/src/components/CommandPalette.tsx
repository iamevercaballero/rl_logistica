import { useEffect, useMemo, useState } from "react";

type CmdItem = { label: string; path: string };

export default function CommandPalette({
  open,
  onClose,
  items,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  items: CmdItem[];
  onSelect: (path: string) => void;
}) {
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!open) return;
    setQ("");
  }, [open]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!open) return;
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return items;
    return items.filter((i) => i.label.toLowerCase().includes(s) || i.path.toLowerCase().includes(s));
  }, [q, items]);

  if (!open) return null;

  return (
    <div
      onMouseDown={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.35)",
        display: "grid",
        placeItems: "start center",
        paddingTop: 90,
        zIndex: 50,
      }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width: "min(680px, calc(100vw - 24px))",
          background: "#fff",
          border: "1px solid #e5e7eb",
          borderRadius: 14,
          overflow: "hidden",
          boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
        }}
      >
        <div style={{ padding: 12, borderBottom: "1px solid #e5e7eb" }}>
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar módulo… (Productos, Palets, Movimientos…) "
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid #e5e7eb",
              outline: "none",
              fontSize: 14,
            }}
          />
          <div style={{ marginTop: 8, fontSize: 12, color: "#6b7280" }}>
            Enter para abrir · Esc para cerrar
          </div>
        </div>

        <div style={{ maxHeight: 320, overflow: "auto" }}>
          {filtered.length === 0 ? (
            <div style={{ padding: 14, color: "#6b7280" }}>Sin resultados</div>
          ) : (
            filtered.map((it) => (
              <button
                key={it.path}
                onClick={() => {
                  onSelect(it.path);
                  onClose();
                }}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "12px 14px",
                  border: "none",
                  borderBottom: "1px solid #f1f5f9",
                  background: "#fff",
                  cursor: "pointer",
                }}
              >
                <div style={{ fontWeight: 800 }}>{it.label}</div>
                <div style={{ fontSize: 12, color: "#6b7280" }}>{it.path}</div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}