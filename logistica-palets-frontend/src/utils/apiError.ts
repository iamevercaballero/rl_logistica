import axios from "axios";

export function getFriendlyApiError(error: unknown): string {
  if (!axios.isAxiosError(error)) return "Ocurrió un error. Probá de nuevo.";

  const status = error.response?.status;
  const detail = error.response?.data?.message;
  if (detail) console.log("API error detail:", detail);

  if (status === 400) return "Datos inválidos. Verificá los campos.";
  if (status === 404) return "Registro no encontrado.";
  if (status === 409) return "Ya existe un registro con esos datos.";
  return "Ocurrió un error. Probá de nuevo.";
}
