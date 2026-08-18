import { useWarehouse } from "../contexts/WarehouseContext";
import { warehouseLabel } from "../api/warehouses";
import { useToast } from "../design-system/toast";

/**
 * Selector global de Depósito Activo — vive en el header y acompaña al usuario
 * por todos los módulos, para que nunca haya duda de en qué depósito se está
 * trabajando.
 *
 * Con un solo depósito habilitado no se ofrece un desplegable inútil: se
 * muestra el depósito como contexto fijo (el caso del OPERATOR de RL LOGÍSTICA).
 */
export default function WarehouseSelector() {
  const { activeWarehouseId, activeWarehouse, allowedWarehouses, setActiveWarehouse, isLoading, hasNoWarehouse } =
    useWarehouse();
  const { toast } = useToast();

  if (hasNoWarehouse) {
    return (
      <span className="badge badge--estado-rechazado" title="Pedí acceso a un administrador">
        Sin depósito asignado
      </span>
    );
  }

  if (isLoading || !activeWarehouseId) {
    return <span className="badge" aria-live="polite">Depósito…</span>;
  }

  const label = warehouseLabel(activeWarehouse);

  if (allowedWarehouses.length <= 1) {
    return (
      <span
        className="badge"
        title="Tu usuario opera únicamente en este depósito"
        style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
      >
        <span style={{ color: "var(--muted)", fontWeight: 600 }}>Depósito:</span>
        {label}
      </span>
    );
  }

  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={{ color: "var(--muted)", fontSize: 12, fontWeight: 600 }}>Depósito:</span>
      <select
        className="input"
        aria-label="Depósito activo"
        value={activeWarehouseId}
        style={{ width: "auto", minWidth: 190, padding: "4px 8px", fontSize: 13, fontWeight: 700 }}
        onChange={(e) => {
          const next = allowedWarehouses.find((w) => w.id === e.target.value);
          if (!next) return;
          setActiveWarehouse(next.id);
          toast.success(`Depósito cambiado a ${warehouseLabel(next)}`);
        }}
      >
        {allowedWarehouses.map((w) => (
          <option key={w.id} value={w.id}>{warehouseLabel(w)}</option>
        ))}
      </select>
    </label>
  );
}
