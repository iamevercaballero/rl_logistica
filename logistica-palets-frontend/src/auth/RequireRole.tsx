import { Navigate } from "react-router-dom";
import { getUserRole, canRead } from "./rbac";

export default function RequireRole({
  module,
  children,
}: {
  module: "products" | "lots" | "warehouses" | "locations" | "pallets" | "movements" | "transports";
  children: React.ReactNode;
}) {
  const role = getUserRole();
  if (!role) return <Navigate to="/login" replace />;

  if (!canRead(module, role)) {
    return (
      <div>
        <h2>Sin permisos</h2>
        <p>Tu rol ({role}) no tiene acceso a este módulo.</p>
      </div>
    );
  }

  return <>{children}</>;
}
