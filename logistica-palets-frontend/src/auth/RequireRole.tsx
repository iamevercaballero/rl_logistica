import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { can } from "./permissions";
import type { ModuleKey } from "./rbac";

export default function RequireRole({
  module,
  children,
}: {
  module: ModuleKey;
  children: ReactNode;
}) {
  const { user, isReady } = useAuth();

  if (!isReady) {
    return null;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!can(user, module, "read")) {
    return (
      <div>
        <h2>Sin permisos</h2>
        <p>No tenés acceso a este módulo.</p>
      </div>
    );
  }

  return <>{children}</>;
}
