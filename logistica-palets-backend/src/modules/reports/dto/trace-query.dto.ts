import { IsUUID } from 'class-validator';

export class TraceQueryDto {
  @IsUUID()
  materialId: string;
}
