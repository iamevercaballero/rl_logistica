import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';

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
}
