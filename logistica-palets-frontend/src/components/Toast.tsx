export type ToastType = "success" | "error" | "info";

export type ToastData = {
  id: number;
  message: string;
  type: ToastType;
};

export function Toast({ message, type }: Omit<ToastData, "id">) {
  const color = type === "success" ? "#166534" : type === "error" ? "#991b1b" : "#1d4ed8";
  const background = type === "success" ? "#dcfce7" : type === "error" ? "#fee2e2" : "#dbeafe";

  return (
    <div style={{ background, color, borderRadius: 8, padding: "10px 12px", minWidth: 240, boxShadow: "0 6px 18px rgba(0,0,0,0.15)" }}>
      {message}
    </div>
  );
}
