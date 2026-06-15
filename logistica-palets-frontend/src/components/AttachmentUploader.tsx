import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  uploadAttachment,
  ATTACHMENT_CATEGORIES,
  type AttachmentCategory,
  type AttachmentEntityType,
} from "../api/attachments";
import { useToast } from "../design-system/toast";
import { getFriendlyApiError } from "../utils/apiError";

interface Props {
  entityType?: AttachmentEntityType;
  entityId?: string;
  onUploaded?: () => void;
  /** Modo diferido: en vez de subir, entrega el archivo al padre (p.ej. remito aún no confirmado). */
  onCollect?: (file: File, name: string, category: AttachmentCategory) => void;
}

const ACCEPTED = ".pdf,.jpg,.jpeg,.png,.webp,.heic,.doc,.docx,.xls,.xlsx";

export default function AttachmentUploader({ entityType, entityId, onUploaded, onCollect }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [category, setCategory] = useState<AttachmentCategory>("REMITO");
  const [error, setError] = useState("");

  const mut = useMutation({
    mutationFn: () => uploadAttachment(file!, name, category, entityType!, entityId!),
    onSuccess: () => {
      toast.success(`Archivo "${name}" adjuntado`);
      setFile(null);
      setName("");
      setError("");
      if (inputRef.current) inputRef.current.value = "";
      void queryClient.invalidateQueries({ queryKey: ["dispatch-log", entityType, entityId] });
      onUploaded?.();
    },
    onError: (err) => {
      const msg = getFriendlyApiError(err);
      setError(msg);
      toast.error(msg);
    },
  });

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    // Auto-sugerir nombre desde el filename (sin extensión)
    if (!name.trim()) {
      setName(f.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " "));
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) { setError("Seleccioná un archivo."); return; }
    if (!name.trim()) { setError("El nombre del archivo es obligatorio."); return; }
    setError("");
    if (onCollect) {
      onCollect(file, name.trim(), category);
      setFile(null);
      setName("");
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    mut.mutate();
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "grid", gap: 8 }}>
      {/* File picker */}
      <div
        style={{ border: "2px dashed var(--border)", borderRadius: 8, padding: "12px 16px", textAlign: "center", cursor: "pointer", background: file ? "var(--primary-light)" : "var(--bg)" }}
        onClick={() => inputRef.current?.click()}
      >
        {file ? (
          <span style={{ fontSize: 13, fontWeight: 600 }}>📎 {file.name} <span style={{ color: "var(--muted)", fontWeight: 400 }}>({(file.size / 1024).toFixed(0)} KB)</span></span>
        ) : (
          <span style={{ fontSize: 13, color: "var(--muted)" }}>Hacé click para seleccionar un archivo (máx. 20 MB)</span>
        )}
        <input ref={inputRef} type="file" accept={ACCEPTED} onChange={handleFileChange} style={{ display: "none" }} />
      </div>

      {/* Nombre obligatorio */}
      <div>
        <div style={{ fontSize: 10, fontWeight: 700, color: "var(--danger)", textTransform: "uppercase", marginBottom: 3 }}>Nombre del archivo *</div>
        <input
          className="input"
          placeholder="Ej: MIC/Factura/Remito firmado"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={200}
          required
        />
      </div>

      {/* Categoría */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
        {ATTACHMENT_CATEGORIES.map((c) => (
          <button
            key={c.value}
            type="button"
            onClick={() => setCategory(c.value)}
            style={{
              padding: "6px 4px",
              borderRadius: 6,
              border: `1.5px solid ${category === c.value ? "var(--primary)" : "var(--border)"}`,
              background: category === c.value ? "var(--primary-light)" : "var(--bg)",
              cursor: "pointer",
              fontSize: 12,
              textAlign: "center",
              fontWeight: category === c.value ? 700 : 400,
            }}
          >
            <div style={{ fontSize: 18 }}>{c.icon}</div>
            <div style={{ marginTop: 2 }}>{c.label}</div>
          </button>
        ))}
      </div>

      {error && <div style={{ color: "var(--danger)", fontSize: 13 }}>{error}</div>}

      <button className="btn btn--primary" type="submit" disabled={mut.isPending || !file}>
        {onCollect ? "Agregar a la lista" : mut.isPending ? "Subiendo..." : "Adjuntar archivo"}
      </button>
    </form>
  );
}
