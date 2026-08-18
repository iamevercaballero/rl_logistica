/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listAllowedWarehouses, type Warehouse } from "../api/warehouses";
import { useAuth } from "../auth/AuthContext";
import { isWarehouseScopedKey, resolveActiveWarehouseId } from "./warehouseScope";

/**
 * Depósito Activo: el contexto operativo de la sesión, no un filtro más.
 *
 * Todos los módulos operativos (dashboard, stock, movimientos, ubicaciones,
 * reportes…) trabajan contra `activeWarehouseId`. El backend valida igual cada
 * request: esto define con qué depósito se trabaja, no a qué se tiene derecho.
 */
const STORAGE_KEY = "activeWarehouseId";

type WarehouseState = {
  activeWarehouseId: string | null;
  activeWarehouse: Warehouse | null;
  allowedWarehouses: Warehouse[];
  setActiveWarehouse: (id: string) => void;
  /** true mientras no se sabe con qué depósito se trabaja. */
  isLoading: boolean;
  /** El usuario no tiene ningún depósito habilitado. */
  hasNoWarehouse: boolean;
};

const WarehouseContext = createContext<WarehouseState | null>(null);

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function WarehouseProvider({ children }: { children: React.ReactNode }) {
  const { user, isReady } = useAuth();
  const queryClient = useQueryClient();
  // Estado = lo que el usuario eligió (o lo que quedó guardado). El depósito
  // efectivo se DERIVA de esto contra la lista de permitidos: así no hace falta
  // un efecto que sincronice estado con estado, y nunca hay un render con un
  // depósito no autorizado a la espera de que el efecto lo corrija.
  const [pickedWarehouseId, setPickedWarehouseId] = useState<string | null>(readStored);

  // Los depósitos permitidos se piden recién con el usuario resuelto: antes de
  // autenticar no hay alcance que consultar.
  const allowedQuery = useQuery({
    queryKey: ["warehouses", "allowed", user?.userId ?? null],
    queryFn: listAllowedWarehouses,
    enabled: isReady && !!user,
    staleTime: 5 * 60_000,
  });

  const allowedWarehouses = useMemo(() => allowedQuery.data ?? [], [allowedQuery.data]);

  // El valor guardado es solo una preferencia: si dejó de estar permitido (le
  // revocaron el acceso, o el depósito se dio de baja) se descarta y se cae al
  // primero autorizado. El backend sigue siendo la autoridad — acá solo se
  // evita trabajar contra un depósito que ya no corresponde.
  const activeWarehouseId = useMemo(() => {
    if (!user) return null;
    return resolveActiveWarehouseId(pickedWarehouseId, allowedWarehouses.map((w) => w.id));
  }, [user, pickedWarehouseId, allowedWarehouses]);

  useEffect(() => {
    try {
      if (activeWarehouseId) localStorage.setItem(STORAGE_KEY, activeWarehouseId);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* modo privado / storage bloqueado: la sesión sigue funcionando en memoria */
    }
  }, [activeWarehouseId]);

  const setActiveWarehouse = useCallback((id: string) => {
    setPickedWarehouseId((current) => {
      if (current === id) return current;
      // Se descarta lo cacheado del depósito anterior antes de pintar nada del
      // nuevo: sin esto la pantalla muestra por un instante datos del depósito
      // que se acaba de dejar, que es justo lo que no puede pasar.
      void queryClient.cancelQueries();
      queryClient.removeQueries({ predicate: (query) => isWarehouseScopedKey(query.queryKey) });
      return id;
    });
  }, [queryClient]);

  const activeWarehouse = useMemo(
    () => allowedWarehouses.find((w) => w.id === activeWarehouseId) ?? null,
    [allowedWarehouses, activeWarehouseId],
  );

  const value = useMemo<WarehouseState>(() => ({
    activeWarehouseId,
    activeWarehouse,
    allowedWarehouses,
    setActiveWarehouse,
    // Se considera "cargando" hasta tener un depósito resuelto: los módulos
    // operativos no deben renderizar datos mientras tanto.
    isLoading: !isReady || (!!user && allowedQuery.isPending),
    hasNoWarehouse: !!user && allowedQuery.isSuccess && allowedWarehouses.length === 0,
  }), [
    activeWarehouse, activeWarehouseId, allowedWarehouses, setActiveWarehouse,
    isReady, user, allowedQuery.isPending, allowedQuery.isSuccess,
  ]);

  return <WarehouseContext.Provider value={value}>{children}</WarehouseContext.Provider>;
}

export function useWarehouse() {
  const ctx = useContext(WarehouseContext);
  if (!ctx) throw new Error("useWarehouse must be used within WarehouseProvider");
  return ctx;
}

/**
 * Id del depósito activo para usar en query keys y en los params de la API.
 * Devuelve `undefined` mientras no está resuelto, para poder desactivar la
 * query (`enabled`) en vez de pedir datos sin alcance.
 */
export function useActiveWarehouseId(): string | undefined {
  return useWarehouse().activeWarehouseId ?? undefined;
}
