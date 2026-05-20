import { api } from "./client";

export type AlertSeverity = "warning" | "critical";

export type AlertType =
  | "STOCK_BELOW_MIN"
  | "LOT_EXPIRING_CRITICAL"
  | "LOT_EXPIRING_WARNING"
  | "PENDING_REGULARIZATION_STALE";

export interface ActiveAlert {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  message: string;
  data: Record<string, unknown>;
  triggeredAt: string;
}

export interface AlertRule {
  id: string;
  description: string | null;
  productId: string | null;
  warehouseId: string | null;
  thresholdMin: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAlertRulePayload {
  description?: string;
  productId?: string;
  warehouseId?: string;
  thresholdMin: number;
  enabled?: boolean;
}

export async function getActiveAlerts(): Promise<ActiveAlert[]> {
  const { data } = await api.get<ActiveAlert[]>("/alerts/active");
  return data;
}

export async function listAlertRules(): Promise<AlertRule[]> {
  const { data } = await api.get<AlertRule[]>("/alerts/rules");
  return data;
}

export async function createAlertRule(payload: CreateAlertRulePayload): Promise<AlertRule> {
  const { data } = await api.post<AlertRule>("/alerts/rules", payload);
  return data;
}

export async function updateAlertRule(
  id: string,
  payload: Partial<CreateAlertRulePayload>,
): Promise<AlertRule> {
  const { data } = await api.patch<AlertRule>(`/alerts/rules/${id}`, payload);
  return data;
}

export async function deleteAlertRule(id: string): Promise<void> {
  await api.delete(`/alerts/rules/${id}`);
}
