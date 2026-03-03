import { IsString, IsOptional, IsBoolean } from 'class-validator';

export class CreateProductDto {
  @IsString()
  code: string;

  @IsString()
  description: string;

  @IsOptional()
  @IsString()
  unitOfMeasure?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
