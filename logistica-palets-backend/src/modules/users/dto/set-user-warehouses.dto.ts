import { ArrayMaxSize, IsArray, IsUUID } from 'class-validator';

export class SetUserWarehousesDto {
  /**
   * Conjunto completo de depósitos del usuario: reemplaza las asignaciones
   * anteriores (no es un "agregar"). Una lista vacía deja al usuario sin
   * depósitos asignados, que para un OPERATOR significa sin acceso operativo.
   */
  @IsArray()
  @IsUUID('4', { each: true })
  @ArrayMaxSize(100)
  warehouseIds: string[];
}
