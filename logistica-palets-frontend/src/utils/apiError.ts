import axios from "axios";

export function getFriendlyApiError(error: unknown): string {
  if (!axios.isAxiosError(error)) {
    return "Ocurrió un error. Probá de nuevo.";
  }

  const status = error.response?.status;
  const detail = error.response?.data?.message;
  const detailText = Array.isArray(detail) ? detail[0] : detail;

  if (typeof detailText === "string" && detailText.trim()) {
    return detailText;
  }

  if (status === 400) return "Datos inválidos. Verificá los campos.";
  if (status === 401) return "La sesión expiró. Volvé a ingresar.";
  if (status === 403) return "No tenés permisos para realizar esta acción.";
  if (status === 404) return "Registro no encontrado.";
  if (status === 409) return "Ya existe un registro con esos datos.";

  return "Ocurrió un error. Probá de nuevo.";
}
