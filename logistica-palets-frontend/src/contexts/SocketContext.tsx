/**
 * SocketContext — real-time WebSocket connection via socket.io
 *
 * Provides:
 *  - `connected`: boolean — whether the socket is currently connected
 *  - `on(event, handler)` — subscribe to a socket event
 *  - `off(event, handler)` — unsubscribe from a socket event
 *
 * The socket connects once on app mount and auto-reconnects.
 * If the backend WS is unreachable, the app continues working normally
 * (only real-time updates are disabled).
 */
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { io, type Socket } from "socket.io-client";

/* ── Types ────────────────────────────────────────────────────────────────── */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyHandler = (...args: any[]) => void;

interface SocketContextValue {
  connected: boolean;
  /** Subscribe to a server-emitted event. */
  on: (event: string, handler: AnyHandler) => void;
  /** Unsubscribe from a server-emitted event. */
  off: (event: string, handler: AnyHandler) => void;
}

/* ── Context ──────────────────────────────────────────────────────────────── */

const SocketContext = createContext<SocketContextValue>({
  connected: false,
  on: () => {},
  off: () => {},
});

/* ── Provider ─────────────────────────────────────────────────────────────── */

const WS_URL =
  (import.meta.env.VITE_WS_URL as string | undefined) ?? "http://localhost:3000";

export function SocketProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const socket = io(`${WS_URL}/events`, {
      transports: ["websocket", "polling"],
      reconnectionDelay: 2_000,
      reconnectionDelayMax: 30_000,
      reconnectionAttempts: Infinity,
      // Don't connect on app mount if the user is offline — the hook returns
      // false for `connected` and retries when the network comes back.
      autoConnect: true,
    });

    socketRef.current = socket;

    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));
    socket.on("connect_error", () => setConnected(false));

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  const on = useCallback((event: string, handler: AnyHandler) => {
    socketRef.current?.on(event, handler);
  }, []);

  const off = useCallback((event: string, handler: AnyHandler) => {
    socketRef.current?.off(event, handler);
  }, []);

  return (
    <SocketContext.Provider value={{ connected, on, off }}>
      {children}
    </SocketContext.Provider>
  );
}

/* ── Hook ─────────────────────────────────────────────────────────────────── */

export function useSocket(): SocketContextValue {
  return useContext(SocketContext);
}

/* ── Payload types (match backend EventsGateway) ─────────────────────────── */

export interface MovementCreatedPayload {
  movementId: string;
  type: string;
  warehouseId?: string | null;
}

export interface StockUpdatedPayload {
  warehouseId?: string | null;
}
