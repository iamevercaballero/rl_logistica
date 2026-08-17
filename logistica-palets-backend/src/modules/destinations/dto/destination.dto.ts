import { IsBoolean, IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class CreateDestinationDto {
  @IsString()
  @Length(2, 120)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateDestinationDto {
  @IsOptional()
  @IsString()
  @Length(2, 120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
