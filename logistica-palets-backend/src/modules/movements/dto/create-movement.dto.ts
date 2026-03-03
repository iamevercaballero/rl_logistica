import { IsString, IsOptional, IsArray, ValidateNested, IsUUID, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

class EntryItemDto {
  @IsString()
  palletCode: string;

  @IsUUID()
  lotId: string;

  @IsUUID()
  locationId: string;

  @IsInt()
  @Min(1)
  quantity: number;
}

export class CreateEntryDto {
  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EntryItemDto)
  items: EntryItemDto[];
}
