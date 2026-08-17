import { useEffect, useMemo, useRef, useState } from "react";

export type HybridSearchInputProps<T> = {
  /** Opciones registradas ya cargadas (filtrado en cliente). */
  options: T[];
  /** Valor actual — siempre texto libre, sea de una opción elegida o tipeado a mano. */
  value: string;
  /** Se dispara con cada tecleo: el campo nunca bloquea la escritura manual. */
  onChange: (text: string) => void;
  /** Se dispara además de onChange cuando se elige una opción registrada (click, Enter o texto exacto al perder foco). */
  onSelect: (opt: T) => void;
  /** Clave estable por opción. */
  getKey: (opt: T) => string;
  /** Texto principal mostrado para la opción (también se usa como valor al elegirla). */
  getLabel: (opt: T) => string;
  /** Texto secundario opcional (descripción). */
  getDescription?: (opt: T) => string;
  /** Badge a la derecha (ej: patente asociada). */
  getBadge?: (opt: T) => string | null | undefined;
  /** Filtro personalizado. Por defecto busca en label + description (case-insensitive). */
  filterFn?: (opt: T, query: string) => boolean;
  placeholder?: string;
  disabled?: boolean;
  clearable?: boolean;
  emptyText?: string;
  /** Alta rápida opcional para guardar el texto actual como nueva opción. */
  onCreate?: (text: string) => void;
  /** Etiqueta de la acción de alta. Recibe el texto normalizado. */
  getCreateLabel?: (text: string) => string;
  creating?: boolean;
  registeredTitle?: string;
  style?: React.CSSProperties;
  id?: string;
};

/**
 * Combobox de texto libre: busca y sugiere opciones registradas, pero nunca
 * exige elegir una — lo tipeado se guarda tal cual si no coincide con nada.
 * Elegir una sugerencia (click, Enter, o tipear el valor exacto y salir del
 * campo) dispara onSelect para que el formulario autocomplete datos
 * relacionados (ej: transportadora y CI al elegir un vehículo/chofer).
 */
export default function HybridSearchInput<T>({
  options,
  value,
  onChange,
  onSelect,
  getKey,
  getLabel,
  getDescription,
  getBadge,
  filterFn,
  placeholder = "Buscar o escribir...",
  disabled,
  clearable = true,
  emptyText = "Sin coincidencias — se guarda como texto libre",
  onCreate,
  getCreateLabel = (text) => `Agregar nuevo: ${text}`,
  creating = false,
  registeredTitle = "Opción registrada",
  style,
  id,
}: HybridSearchInputProps<T>) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const defaultFilter = (opt: T, q: string) => {
    const hay = `${getLabel(opt)} ${getDescription?.(opt) ?? ""}`.toLowerCase();
    return hay.includes(q);
  };

  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return options;
    const fn = filterFn ?? defaultFilter;
    return options.filter((o) => fn(o, q));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options, value, filterFn]);

  const exactMatch = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return false;
    return options.some((o) => getLabel(o).trim().toLowerCase() === q);
  }, [options, value, getLabel]);
  const canCreate = !!onCreate && value.trim().length >= 2 && !exactMatch;
  const selectableCount = filtered.length + (canCreate ? 1 : 0);

  useEffect(() => { setHighlight(0); }, [value, open]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function handlePick(opt: T) {
    onChange(getLabel(opt));
    onSelect(opt);
    setOpen(false);
  }

  function handleCreate() {
    const text = value.trim();
    if (!onCreate || text.length < 2 || exactMatch || creating) return;
    onCreate(text);
    setOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, Math.max(selectableCount - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      if (open && filtered[highlight]) {
        e.preventDefault();
        handlePick(filtered[highlight]);
      } else if (open && canCreate && highlight === filtered.length) {
        e.preventDefault();
        handleCreate();
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  /** Si lo tipeado coincide exacto con una opción al salir del campo, se toma como elegida (sin obligar a clickear). */
  function handleBlur() {
    setOpen(false);
    const q = value.trim().toLowerCase();
    if (!q) return;
    const match = options.find((o) => getLabel(o).trim().toLowerCase() === q);
    if (match) handlePick(match);
  }

  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.children[highlight] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [highlight, open]);

  return (
    <div ref={wrapRef} style={{ position: "relative", ...style }}>
      <div style={{ position: "relative" }}>
        <input
          id={id}
          className="input"
          type="text"
          placeholder={placeholder}
          value={value}
          onChange={(e) => { onChange(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          disabled={disabled}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          style={{ paddingRight: exactMatch || (value && clearable) ? 32 : undefined }}
        />
        {exactMatch && (
          <span
            title={registeredTitle}
            style={{
              position: "absolute", right: value && clearable ? 28 : 10, top: "50%", transform: "translateY(-50%)",
              color: "var(--success)", fontSize: 13, pointerEvents: "none",
            }}
          >✓</span>
        )}
        {value && clearable && (
          <button
            type="button"
            onClick={() => { onChange(""); setOpen(false); }}
            style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--muted)", fontSize: 16, lineHeight: 1, padding: 0 }}
            tabIndex={-1}
            aria-label="Limpiar"
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
                onMouseDown={(e) => { e.preventDefault(); handlePick(opt); }}
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
          {canCreate && (
            <button
              type="button"
              role="option"
              aria-selected={highlight === filtered.length}
              disabled={creating}
              onMouseDown={(e) => { e.preventDefault(); handleCreate(); }}
              onMouseEnter={() => setHighlight(filtered.length)}
              style={{
                display: "block", width: "100%", textAlign: "left", padding: "10px 14px",
                background: highlight === filtered.length ? "var(--primary-light)" : "none",
                color: "var(--primary)", fontWeight: 800, fontSize: 13,
                border: "none", cursor: creating ? "wait" : "pointer",
              }}
            >
              {creating ? "Guardando destino..." : `+ ${getCreateLabel(value.trim())}`}
            </button>
          )}
          {filtered.length === 0 && !canCreate && (
            <div style={{ padding: "10px 14px", color: "var(--muted)", fontSize: 13 }}>{emptyText}</div>
          )}
        </div>
      )}
    </div>
  );
}
