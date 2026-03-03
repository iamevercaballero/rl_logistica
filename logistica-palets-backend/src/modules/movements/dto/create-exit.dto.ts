import { IsArray, ValidateNested, IsUUID, IsInt, Min, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export class ExitItemDto {
  @IsUUID()
  palletId: string;

  @IsInt()
  @Min(1)
  quantity: number;
}

export class CreateExitDto {
  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExitItemDto)
  items: ExitItemDto[];
}
