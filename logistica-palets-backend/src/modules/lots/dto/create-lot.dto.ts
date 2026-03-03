import { IsString, IsUUID } from 'class-validator';

export class CreateLotDto {
  @IsString()
  lotCode: string;

  @IsUUID()
  productId: string;
}
