import { Navigate } from "react-router-dom";
import { canRead } from "./rbac";
import { useAuth } from "./AuthContext";

export default function RequireRole({
  module,
  children,
}: {
  module: "products" | "lots" | "warehouses" | "locations" | "pallets" | "movements" | "transports";
  children: React.ReactNode;
}) {
  const { user, isReady } = useAuth();

  if (!isReady) return null; // evita parpadeo/redirect por timing
  if (!user) return <Navigate to="/login" replace />;

  const role = user.role;

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