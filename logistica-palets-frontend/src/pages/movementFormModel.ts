import type { MovementType } from "../api/movements";

export function showsExternalDocumentNumber(type: MovementType) {
  return type === "ENTRY";
}

export function responsibleFieldLabel(type: MovementType) {
  return type === "EXIT" ? "Encargado de envío" : "Encargado de recepción";
}
