import { IsString, IsOptional } from 'class-validator';

export class CreateTransportDto {
  @IsString()
  plate: string;

  @IsString()
  type: string;

  @IsOptional()
  @IsString()
  description?: string;
}
