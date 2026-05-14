import { useEffect, useRef, useState } from "react";
import { searchProducts, type Product } from "../api/products";

type Props = {
  value: Product | null;
  onChange: (product: Product | null) => void;
  placeholder?: string;
  disabled?: boolean;
};

export default function ProductSearch({ value, onChange, placeholder = "Buscar material (código o descripción)...", disabled }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Product[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    if (!query.trim() || value) { setResults([]); setOpen(false); return; }
    debounce.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await searchProducts(query);
        setResults(res);
        setOpen(res.length > 0);
      } finally {
        setLoading(false);
      }
    }, 250);
  }, [query, value]);

  // Cerrar al hacer click fuera
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    onChange(null); // limpiar selección al escribir
    setQuery(e.target.value);
  }

  function handleSelect(p: Product) {
    onChange(p);
    setQuery("");
    setOpen(false);
    setResults([]);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    // Soporte lector de barras: Enter selecciona el primer resultado
    if (e.key === "Enter" && results.length > 0) {
      e.preventDefault();
      handleSelect(results[0]);
    }
    if (e.key === "Escape") { setOpen(false); }
  }

  function handleClear() {
    onChange(null);
    setQuery("");
    setResults([]);
    setOpen(false);
  }

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <div style={{ position: "relative" }}>
        <input
          className="input"
          type="text"
          placeholder={placeholder}
          value={value ? `${value.code} · ${value.description}` : query}
          onChange={handleInputChange}
          onFocus={() => { if (results.length > 0) setOpen(true); }}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          autoComplete="off"
          style={{ paddingRight: value ? 32 : undefined }}
        />
        {value && (
          <button
            type="button"
            onClick={handleClear}
            style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--muted)", fontSize: 16, lineHeight: 1, padding: 0 }}
            tabIndex={-1}
          >×</button>
        )}
      </div>

      {open && (
        <div style={{
          position: "absolute", zIndex: 1000, top: "calc(100% + 4px)", left: 0, right: 0,
          background: "var(--panel)", border: "1.5px solid var(--border)", borderRadius: 10,
          boxShadow: "0 8px 24px rgba(0,0,0,.18)", maxHeight: 280, overflowY: "auto",
        }}>
          {loading && (
            <div style={{ padding: "10px 14px", color: "var(--muted)", fontSize: 13 }}>Buscando...</div>
          )}
          {!loading && results.map((p) => (
            <button
              key={p.id}
              type="button"
              onMouseDown={() => handleSelect(p)}
              style={{
                display: "block", width: "100%", textAlign: "left", padding: "9px 14px",
                background: "none", border: "none", cursor: "pointer", borderBottom: "1px solid var(--border)",
                transition: "background .12s",
              }}
              onMouseEnter={e => (e.currentTarget.style.background = "var(--primary-light)")}
              onMouseLeave={e => (e.currentTarget.style.background = "none")}
            >
              <span style={{ fontWeight: 700, fontSize: 13 }}>{p.code}</span>
              <span style={{ color: "var(--muted)", fontSize: 12, marginLeft: 8 }}>{p.description}</span>
              {p.unitOfMeasure && (
                <span style={{ float: "right", fontSize: 11, color: "var(--primary)", fontWeight: 600 }}>{p.unitOfMeasure}</span>
              )}
            </button>
          ))}
          {!loading && results.length === 0 && (
            <div style={{ padding: "10px 14px", color: "var(--muted)", fontSize: 13 }}>Sin resultados</div>
          )}
        </div>
      )}
    </div>
  );
}
