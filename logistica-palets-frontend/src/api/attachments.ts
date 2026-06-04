import { api } from "./client";

export type AttachmentCategory = "CAMION" | "PALLET" | "REMITO" | "OTRO";
export type AttachmentEntityType = "MOVEMENT" | "DOCUMENT" | "ADJUSTMENT";

export const ATTACHMENT_CATEGORIES: { value: AttachmentCategory; label: string; icon: string }[] = [
  { value: "REMITO",  label: "Remito / Documento", icon: "📄" },
  { value: "CAMION",  label: "Camión / Transporte", icon: "🚛" },
  { value: "PALLET",  label: "Pallet / Mercadería",  icon: "📦" },
  { value: "OTRO",    label: "Otro",                icon: "📎" },
];

export type Attachment = {
  id: string;
  name: string;
  originalName: string;
  category: AttachmentCategory;
  mimeType: string;
  fileSize: number;
  entityType: AttachmentEntityType;
  entityId: string;
  createdById: string;
  createdAt: string;
};

export type DocumentEvent = {
  id: string;
  entityType: string;
  entityId: string;
  entityCode?: string | null;
  eventType: string;
  description: string;
  metadata?: string | null;
  userId?: string | null;
  username?: string | null;
  createdAt: string;
};

export type DispatchLog = {
  events: DocumentEvent[];
  attachments: Attachment[];
};

export async function uploadAttachment(
  file: File,
  name: string,
  category: AttachmentCategory,
  entityType: AttachmentEntityType,
  entityId: string,
): Promise<Attachment> {
  const form = new FormData();
  form.append("file", file);
  const params = new URLSearchParams({ name, category, entityType, entityId });
  const { data } = await api.post<Attachment>(`/attachments?${params}`, form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

export async function getAttachments(
  entityType: AttachmentEntityType,
  entityId: string,
): Promise<Attachment[]> {
  const { data } = await api.get<Attachment[]>("/attachments", {
    params: { entityType, entityId },
  });
  return data;
}

export async function getDispatchLog(
  entityType: string,
  entityId: string,
): Promise<DispatchLog> {
  const { data } = await api.get<DispatchLog>("/attachments/log", {
    params: { entityType, entityId },
  });
  return data;
}

export async function deleteAttachment(id: string): Promise<void> {
  await api.delete(`/attachments/${id}`);
}

export async function getAllEvents(params: {
  entityType?: string;
  eventType?: string;
  from?: string;
  to?: string;
  search?: string;
  page?: number;
  limit?: number;
} = {}): Promise<{ data: DocumentEvent[]; meta: { page: number; limit: number; total: number; totalPages: number } }> {
  const { data } = await api.get("/attachments/events", { params });
  return data;
}

/** URL para ver/descargar un archivo adjunto */
export function attachmentFileUrl(id: string): string {
  const base = (import.meta.env.VITE_API_URL as string | undefined) ?? "/api";
  return `${base}/attachments/${id}/file`;
}
