import { forwardRef, useId } from "react";
import {
  countQtyDecimals,
  fmtQty,
  isIncompleteQtyInput,
  parseQtyInput,
  QUANTITY_DECIMALS,
  qtyInputError,
  roundQty,
} from "../../utils/quantity";

export type QuantityInputProps = {
  /** Estado crudo del padre (string, como el resto de los formularios). */
  value: string;
  /** Devuelve el texto crudo — el padre lo guarda tal cual. */
  onChange: (raw: string) => void;
  /** Mínimo permitido. Con `allowZero` el default es 0; si no, `MIN_QUANTITY`. */
  min?: number;
  /** Máximo permitido — sólo para el mensaje/borde, la regla dura la valida el padre. */
  max?: number;
  /** Acepta 0 (conteos físicos, correcciones a cero). */
  allowZero?: boolean;
  /** El campo es obligatorio: vacío pasa a ser error al salir. */
  required?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  placeholder?: string;
  /** Unidad de medida — se anexa al `aria-label` para lectores de pantalla. */
  unitOfMeasure?: string | null;
  /** Fuerza el estado inválido desde el padre (ej. la suma por palet no cuadra). */
  invalid?: boolean;
  /** Muestra el texto del error debajo del campo. */
  showError?: boolean;
  "aria-label"?: string;
  id?: string;
  className?: string;
  style?: React.CSSProperties;
  /** Alinea el texto a la derecha (celdas de tabla). */
  align?: "left" | "right";
  onFocus?: React.FocusEventHandler<HTMLInputElement>;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
};

/**
 * Campo de cantidad decimal, reutilizable en todo el sistema.
 *
 * Es `type="text"` con `inputMode="decimal"` a propósito: `type="number"` no
 * deja tipear coma en la mayoría de los navegadores y su validación nativa
 * ("los dos valores válidos más aproximados son…") se adelanta al submit y tapa
 * los mensajes de la app. Acá:
 *
 *  - se admite coma y punto (`3537,37` y `3537.37`) — `parseQtyInput` los
 *    interpreta, incluido el separador de miles;
 *  - se conserva exactamente lo que el operador escribió mientras edita, sin
 *    marcarlo en rojo mientras completa el decimal;
 *  - al salir del campo (blur) el valor se muestra en formato regional
 *    (`3.537,37`), sin alterar lo que se envía;
 *  - el padre sigue teniendo el estado como string y arma el payload con
 *    `toQtyPayload`.
 */
const QuantityInput = forwardRef<HTMLInputElement, QuantityInputProps>(function QuantityInput(
  {
    value,
    onChange,
    min,
    max,
    allowZero,
    required,
    disabled,
    readOnly,
    placeholder,
    unitOfMeasure,
    invalid,
    showError,
    "aria-label": ariaLabel,
    id,
    className,
    style,
    align = "left",
    onFocus,
    onKeyDown,
  },
  ref,
) {
  const autoId = useId();
  const errorId = `${id ?? autoId}-error`;

  const rule = { min, max, allowZero, required };
  const ownError = readOnly || disabled ? null : qtyInputError(value, rule);
  const isInvalid = invalid || (ownError !== null && !isIncompleteQtyInput(value));

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    // Quita lo que no puede ser parte de un número; deja pasar dígitos,
    // separadores y el signo para que `parseQtyInput` los interprete.
    onChange(event.target.value.replace(/[^\d.,\s-]/g, ""));
  };

  const handleBlur = () => {
    if (readOnly || disabled) return;
    const trimmed = value.trim();
    if (trimmed === "") return;
    const parsed = parseQtyInput(trimmed);
    // Sólo canoniza si parsea limpio y no excede la escala — un valor con más
    // decimales de la cuenta se deja como está para que el operador lo corrija
    // (canonizarlo lo redondearía en silencio).
    if (parsed === null || countQtyDecimals(trimmed) > QUANTITY_DECIMALS) return;
    const canonical = fmtQty(roundQty(parsed));
    if (canonical !== value) onChange(canonical);
  };

  return (
    <>
      <input
        ref={ref}
        id={id}
        className={className ? `input ${className}` : "input"}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={value}
        onChange={handleChange}
        onBlur={handleBlur}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
        disabled={disabled}
        readOnly={readOnly}
        placeholder={placeholder}
        aria-label={ariaLabel ? (unitOfMeasure ? `${ariaLabel} (${unitOfMeasure})` : ariaLabel) : undefined}
        aria-invalid={isInvalid || undefined}
        aria-describedby={showError && ownError ? errorId : undefined}
        style={{ textAlign: align, ...style, ...(isInvalid ? { borderColor: "var(--danger)" } : null) }}
      />
      {showError && ownError && !isIncompleteQtyInput(value) && (
        <p id={errorId} style={{ color: "var(--danger)", fontSize: 11, margin: "3px 0 0" }}>
          {ownError}
        </p>
      )}
    </>
  );
});

export default QuantityInput;
