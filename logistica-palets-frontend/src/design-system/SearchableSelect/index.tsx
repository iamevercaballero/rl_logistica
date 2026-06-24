import { useEffect, useMemo, useRef, useState } from "react";

export type SearchableSelectProps<T> = {
  /** Opciones ya cargadas (filtrado en cliente). */
  options: T[];
  /** Opción seleccionada (o null). */
  value: T | null;
  onChange: (opt: T | null) => void;
  /** Clave estable por opción (id). */
  getKey: (opt: T) => string;
  /** Texto principal mostrado para la opción. */
  getLabel: (opt: T) => string;
  /** Texto secundario opcional (descripción). */
  getDescription?: (opt: T) => string;
  /** Badge a la derecha (ej: unidad, stock, estado). */
  getBadge?: (opt: T) => string | null | undefined;
  /** Filtro personalizado. Por defecto busca en label + description (case-insensitive). */
  filterFn?: (opt: T, query: string) => boolean;
  placeholder?: string;
  disabled?: boolean;
  /** Mostrar botón de limpiar (×). Default: true. */
  clearable?: boolean;
  emptyText?: string;
  /** Ancho del control. */
  style?: React.CSSProperties;
  /** id para asociar <label htmlFor>. */
  id?: string;
};

/**
 * Selector con búsqueda al escribir, filtrado en vivo y navegación por teclado.
 * Componente común del sistema — usar en productos, lotes, pallets, ubicaciones,
 * depósitos, transportes, choferes, clientes/proveedores y usuarios.
 */
export default function SearchableSelect<T>({
  options,
  value,
  onChange,
  getKey,
  getLabel,
  getDescription,
  getBadge,
  filterFn,
  placeholder = "Buscar...",
  disabled,
  clearable = true,
  emptyText = "Sin resultados",
  style,
  id,
}: SearchableSelectProps<T>) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const defaultFilter = (opt: T, q: string) => {
    const hay = `${getLabel(opt)} ${getDescription?.(opt) ?? ""}`.toLowerCase();
    return hay.includes(q);
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    const fn = filterFn ?? defaultFilter;
    return options.filter((o) => fn(o, q));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options, query, filterFn]);

  // Reset highlight cuando cambian los resultados
  useEffect(() => { setHighlight(0); }, [query, open]);

  // Cerrar al click afuera
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function handleSelect(opt: T) {
    onChange(opt);
    setQuery("");
    setOpen(false);
  }

  function handleClear() {
    onChange(null);
    setQuery("");
    setOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      if (open && filtered[highlight]) {
        e.preventDefault();
        handleSelect(filtered[highlight]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  // Mantener visible el item resaltado
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.children[highlight] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [highlight, open]);

  const displayText = value ? getLabel(value) + (getDescription?.(value) ? ` · ${getDescription(value)}` : "") : query;

  return (
    <div ref={wrapRef} style={{ position: "relative", ...style }}>
      <div style={{ position: "relative" }}>
        <input
          id={id}
          className="input"
          type="text"
          placeholder={placeholder}
          value={displayText}
          onChange={(e) => { if (value) onChange(null); setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          style={{ paddingRight: value && clearable ? 32 : undefined }}
        />
        {value && clearable && (
          <button
            type="button"
            onClick={handleClear}
            style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--muted)", fontSize: 16, lineHeight: 1, padding: 0 }}
            tabIndex={-1}
            aria-label="Limpiar selección"
          >×</button>
        )}
      </div>

      {open && (
        <div
          ref={listRef}
          role="listbox"
          style={{
            position: "absolute", zIndex: 1000, top: "calc(100% + 4px)", left: 0, right: 0,
            background: "var(--panel)", border: "1.5px solid var(--border)", borderRadius: 10,
            boxShadow: "0 8px 24px rgba(0,0,0,.18)", maxHeight: 280, overflowY: "auto",
          }}
        >
          {filtered.map((opt, i) => {
            const badge = getBadge?.(opt);
            const desc = getDescription?.(opt);
            return (
              <button
                key={getKey(opt)}
                type="button"
                role="option"
                aria-selected={i === highlight}
                onMouseDown={(e) => { e.preventDefault(); handleSelect(opt); }}
                onMouseEnter={() => setHighlight(i)}
                style={{
                  display: "block", width: "100%", textAlign: "left", padding: "9px 14px",
                  background: i === highlight ? "var(--primary-light)" : "none",
                  border: "none", cursor: "pointer", borderBottom: "1px solid var(--border)",
                }}
              >
                <span style={{ fontWeight: 700, fontSize: 13 }}>{getLabel(opt)}</span>
                {desc && <span style={{ color: "var(--muted)", fontSize: 12, marginLeft: 8 }}>{desc}</span>}
                {badge && <span style={{ float: "right", fontSize: 11, color: "var(--primary)", fontWeight: 600 }}>{badge}</span>}
              </button>
            );
          })}
          {filtered.length === 0 && (
            <div style={{ padding: "10px 14px", color: "var(--muted)", fontSize: 13 }}>{emptyText}</div>
          )}
        </div>
      )}
    </div>
  );
}
