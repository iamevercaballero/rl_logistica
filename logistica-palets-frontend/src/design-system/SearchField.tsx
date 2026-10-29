import { useEffect, useRef, type CSSProperties } from "react";
import { SEARCH_DEBOUNCE_MS, useDebouncedValue } from "../utils/useDebouncedValue";

type Props = {
  value: string;
  onChange: (value: string) => void;
  /**
   * Se llama con el texto a buscar. Recibe el valor como argumento y no lo lee
   * del estado del padre a propósito: al limpiar con la ✕ se avisa en el mismo
   * tick que el `onChange`, cuando el padre todavía tiene el texto anterior.
   */
  onSearch?: (value: string) => void;
  label: string;
  placeholder?: string;
  /**
   * Lista completa de campos que recorre la búsqueda, como tooltip. El
   * placeholder no da para nombrarlos todos sin quedar cortado (ver
   * `utils/searchFields.ts`).
   */
  title?: string;
  style?: CSSProperties;
};

/** Búsqueda libre, con el mismo aspecto que el buscador de Pallets. */
export default function SearchField({ value, onChange, onSearch, label, placeholder = "Buscar código, producto, lote…", title, style }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  /*
   * Busca sola al dejar de escribir.
   *
   * Antes había que apretar Enter o el botón, y era la única pantalla del
   * sistema que lo pedía —Lotes, Palets, Materiales y el resto filtran mientras
   * se tipea—. Esa diferencia se siente como que el buscador no anda: escribís
   * y no pasa nada.
   *
   * Enter y el botón siguen funcionando como atajo: aplican sin esperar.
   */
  const valorAplicado = useDebouncedValue(value, SEARCH_DEBOUNCE_MS);
  // Qué se buscó por última vez, para no repetir la consulta con lo mismo.
  const ultimoBuscado = useRef(value);
  const onSearchRef = useRef(onSearch);
  // El callback se refresca en un efecto y no durante el render: tocar un ref
  // mientras se renderiza es justo lo que React pide evitar.
  useEffect(() => { onSearchRef.current = onSearch; });

  useEffect(() => {
    if (valorAplicado === ultimoBuscado.current) return;
    ultimoBuscado.current = valorAplicado;
    onSearchRef.current?.(valorAplicado);
  }, [valorAplicado]);

  /** Enter, el botón o limpiar: aplica ya, sin esperar el retraso. */
  const buscarAhora = (valor: string) => {
    ultimoBuscado.current = valor;
    onSearchRef.current?.(valor);
  };
  return (
    <div style={{ position: "relative", flex: "1 1 240px", maxWidth: 440, ...style }}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2"
        style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} aria-hidden="true">
        <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <input ref={inputRef} className="input" type="text" role="searchbox" value={value} aria-label={label} placeholder={placeholder} title={title}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); buscarAhora(value); } }}
        style={{ paddingLeft: 30, paddingRight: value ? 32 : 10, width: "100%", boxSizing: "border-box" }} />
      {value && (
        <button type="button" aria-label={`Limpiar ${label.toLowerCase()}`} onClick={() => { onChange(""); buscarAhora(""); inputRef.current?.focus(); }}
          style={{ position: "absolute", right: 7, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--muted)", padding: 2 }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      )}
    </div>
  );
}
