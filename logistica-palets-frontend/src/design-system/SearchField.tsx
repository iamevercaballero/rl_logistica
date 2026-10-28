import { useRef, type CSSProperties } from "react";

type Props = {
  value: string;
  onChange: (value: string) => void;
  onSearch?: () => void;
  label: string;
  placeholder?: string;
  style?: CSSProperties;
};

/** Búsqueda libre, con el mismo aspecto que el buscador de Pallets. */
export default function SearchField({ value, onChange, onSearch, label, placeholder = "Buscar código, producto, lote…", style }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div style={{ position: "relative", flex: "1 1 240px", maxWidth: 440, ...style }}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2"
        style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} aria-hidden="true">
        <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <input ref={inputRef} className="input" type="text" role="searchbox" value={value} aria-label={label} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); onSearch?.(); } }}
        style={{ paddingLeft: 30, paddingRight: value ? 32 : 10, width: "100%", boxSizing: "border-box" }} />
      {value && (
        <button type="button" aria-label={`Limpiar ${label.toLowerCase()}`} onClick={() => { onChange(""); inputRef.current?.focus(); }}
          style={{ position: "absolute", right: 7, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--muted)", padding: 2 }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      )}
    </div>
  );
}
