import { IsString, IsOptional, IsIn, MinLength } from 'class-validator';

export class CreateUserDto {
  @IsString()
  username: string;

  @IsString()
  @MinLength(6)
  password: string;

  @IsOptional()
  @IsIn(['ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR'])
  role?: string;

  @IsOptional()
  @IsString()
  fullName?: string;
}
