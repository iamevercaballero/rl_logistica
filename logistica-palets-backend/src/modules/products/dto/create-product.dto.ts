import { IsBoolean, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateProductDto {
  @IsString()
  @Length(1, 80)
  code: string;

  @IsString()
  @Length(2, 160)
  description: string;

  @IsOptional()
  @IsString()
  @Length(1, 20)
  unitOfMeasure?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  stockMinimo?: number;

  @IsOptional()
  @IsBoolean()
  stackable?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  maxStackLevel?: number | null;

  @IsOptional()
  @IsBoolean()
  canReceiveWeightOnTop?: boolean;

  @IsOptional()
  @IsString()
  @Length(0, 200)
  stackingNotes?: string | null;
}
