import { IsArray, ValidateNested, IsUUID, IsInt, Min, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export class EntryItemDto {
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
