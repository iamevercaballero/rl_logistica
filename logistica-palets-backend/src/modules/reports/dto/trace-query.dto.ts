import { IsUUID } from 'class-validator';

export class TraceQueryDto {
  @IsUUID()
  palletId: string;
}
