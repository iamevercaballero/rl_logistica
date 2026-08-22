import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getUser } from "../../api/users";
import GeneralTab from "./GeneralTab";
import WarehousesTab from "./WarehousesTab";
import PermissionsTab from "./PermissionsTab";
import SecurityTab from "./SecurityTab";
import HistoryTab from "./HistoryTab";

const ROLE_BADGE: Record<string, string> = {
  ADMIN: "badge badge--role-admin",
  MANAGER: "badge badge--role-manager",
  OPERATOR: "badge badge--role-operator",
  AUDITOR: "badge badge--role-auditor",
};

const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Administrador",
  MANAGER: "Gerente",
  OPERATOR: "Operador",
  AUDITOR: "Auditor",
};

type TabKey = "general" | "depositos" | "permisos" | "seguridad" | "historial";

const TABS: { key: TabKey; label: string }[] = [
  { key: "general", label: "General" },
  { key: "depositos", label: "Depósitos" },
  { key: "permisos", label: "Permisos" },
  { key: "seguridad", label: "Seguridad" },
  { key: "historial", label: "Historial" },
];

type Props = {
  userId: string;
  onClose: () => void;
  actor: { userId: string; role: string };
  actorNames: Map<string, string>;
};

export default function UserFichaDrawer({ userId, onClose, actor, actorNames }: Props) {
  const [tab, setTab] = useState<TabKey>("general");

  const userQ = useQuery({ queryKey: ["user", userId], queryFn: () => getUser(userId) });
  const user = userQ.data;

  const readOnly = !!user && actor.role === "MANAGER" && (user.role === "ADMIN" || user.role === "MANAGER");
  const isSelf = actor.userId === userId;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex" }} onClick={onClose}>
      <div style={{ flex: 1, background: "rgba(0,0,0,0.45)" }} />

      <div
        style={{ width: "min(680px, 100vw)", background: "var(--bg-base)", display: "flex", flexDirection: "column", boxShadow: "-4px 0 24px rgba(0,0,0,0.3)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div style={{ padding: "18px 24px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexShrink: 0 }}>
          <div>
            {userQ.isLoading && <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>Cargando…</h3>}
            {user && (
              <>
                <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800 }}>
                  {user.fullName || user.username}
                  {isSelf && <span style={{ marginLeft: 8, fontSize: 12, color: "var(--primary)", fontWeight: 600 }}>(tú)</span>}
                </h3>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13, color: "var(--muted)" }}>@{user.username}</span>
                  <span className={ROLE_BADGE[user.role] ?? "badge"}>{ROLE_LABELS[user.role] ?? user.role}</span>
                  <span className={user.active ? "badge badge--entry" : "badge"}>{user.active ? "Activo" : "Inactivo"}</span>
                </div>
              </>
            )}
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "var(--muted)", flexShrink: 0 }} aria-label="Cerrar">×</button>
        </div>

        {/* ── Tabs ── */}
        {user && (
          <div className="tabs" role="tablist" aria-label="Secciones de la ficha de usuario" style={{ padding: "0 24px", marginBottom: 0, flexShrink: 0 }}>
            {TABS.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={tab === t.key}
                className={`tab${tab === t.key ? " tab--active" : ""}`}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

        {/* ── Contenido ── */}
        <div style={{ padding: "20px 24px", flex: 1, overflowY: "auto" }}>
          {userQ.isError && <p className="form-error">No se pudo cargar el usuario.</p>}
          {user && (
            // `key={user.id}` en cada pestaña: si alguna vez se pudiera pasar de
            // gestionar un usuario a otro sin desmontar el drawer, cada pestaña
            // arranca de cero en vez de arrastrar el estado local del anterior.
            <>
              {tab === "general" && <GeneralTab key={user.id} user={user} readOnly={readOnly} actorRole={actor.role} />}
              {tab === "depositos" && <WarehousesTab key={user.id} user={user} readOnly={readOnly} />}
              {tab === "permisos" && <PermissionsTab key={user.id} user={user} readOnly={readOnly} />}
              {tab === "seguridad" && <SecurityTab key={user.id} user={user} readOnly={readOnly} isSelf={isSelf} />}
              {tab === "historial" && <HistoryTab key={user.id} userId={user.id} actorNames={actorNames} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
