import { IsString, IsUUID } from 'class-validator';

export class CreateLocationDto {
  @IsString()
  code: string; // ej: A1-01-02

  @IsUUID()
  warehouseId: string;
}
