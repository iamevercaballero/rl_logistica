import { IsBoolean, IsIn, IsOptional, IsString, Matches } from 'class-validator';
import { PASSWORD_PATTERN, PASSWORD_POLICY_MESSAGE } from '../password-policy';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  username?: string;

  @IsOptional()
  @Matches(PASSWORD_PATTERN, { message: PASSWORD_POLICY_MESSAGE })
  password?: string;

  @IsOptional()
  @IsIn(['ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR'])
  role?: string;

  @IsOptional()
  @IsString()
  fullName?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
