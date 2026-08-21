import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Texto que no entra en su celda.
 *
 * El patrón que había repetido por toda la app —`overflow: hidden` +
 * `textOverflow: ellipsis` + un ancho fijo— corta el contenido y **no deja
 * forma de verlo**: una observación de tres renglones en la columna Notas de
 * Reportes queda como "Se recibió con faltante de…" y ahí muere. El dato está
 * guardado, pero para leerlo hay que abrir el remito.
 *
 * Este componente mantiene el recorte (las tablas siguen siendo legibles de un
 * vistazo) y agrega la salida: si el texto realmente no entra, aparece un
 * "ver todo" que lo despliega en el lugar, y un "ver menos" para volver. Si
 * entra completo no aparece nada — sin ruido donde no hace falta.
 *
 * El recorte se mide, no se adivina: se compara el alto real del contenido
 * contra el visible, y se vuelve a medir cuando cambia el tamaño (columna que
 * se ensancha, ventana que se achica). Un umbral por cantidad de caracteres
 * daría falsos positivos con textos cortos en columnas anchas.
 */
export type ExpandableTextProps = {
  /** Texto a mostrar. Vacío/nulo cae en `emptyText`. */
  value?: string | null;
  /** Renglones visibles mientras está plegado. */
  lines?: number;
  /** Qué mostrar cuando no hay texto. */
  emptyText?: string;
  className?: string;
  style?: React.CSSProperties;
  /** Etiqueta accesible del botón — por defecto, genérica. */
  label?: string;
};

export default function ExpandableText({
  value,
  lines = 2,
  emptyText = "—",
  className,
  style,
  label = "texto",
}: ExpandableTextProps) {
  const textRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  const measure = useCallback(() => {
    const el = textRef.current;
    if (!el) return;
    // Con el texto desplegado no hay recorte que medir, pero el botón tiene que
    // seguir estando para poder volver: se conserva el estado anterior.
    if (expanded) return;
    setOverflows(el.scrollHeight - el.clientHeight > 1);
  }, [expanded]);

  useEffect(() => {
    measure();
    const el = textRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure, value, lines]);

  const text = value?.trim();
  if (!text) return <span style={style} className={className}>{emptyText}</span>;

  return (
    <div className={className} style={{ display: "grid", gap: 2, ...style }}>
      <div
        ref={textRef}
        // `title` cubre el hover con mouse; el botón cubre el resto (táctil,
        // teclado, y textos demasiado largos para un tooltip).
        title={overflows && !expanded ? text : undefined}
        style={
          expanded
            ? { whiteSpace: "pre-wrap", overflowWrap: "anywhere" }
            : {
                display: "-webkit-box",
                WebkitBoxOrient: "vertical",
                WebkitLineClamp: lines,
                overflow: "hidden",
                overflowWrap: "anywhere",
              }
        }
      >
        {text}
      </div>
      {(overflows || expanded) && (
        <button
          type="button"
          onClick={(event) => {
            // Vive dentro de filas y tarjetas clickeables: expandir no puede
            // disparar además la acción de la fila.
            event.stopPropagation();
            setExpanded((open) => !open);
          }}
          style={{
            justifySelf: "start",
            background: "none",
            border: "none",
            padding: 0,
            font: "inherit",
            fontSize: 11,
            fontWeight: 700,
            color: "var(--primary-text)",
            cursor: "pointer",
            textDecoration: "underline",
          }}
          aria-expanded={expanded}
          aria-label={expanded ? `Ver menos ${label}` : `Ver ${label} completo`}
        >
          {expanded ? "ver menos" : "ver todo"}
        </button>
      )}
    </div>
  );
}
