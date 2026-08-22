import { IsBoolean, IsIn, IsOptional, IsString, Matches } from 'class-validator';
import { PASSWORD_PATTERN, PASSWORD_POLICY_MESSAGE } from '../password-policy';

export class CreateUserDto {
  @IsString()
  username: string;

  @Matches(PASSWORD_PATTERN, { message: PASSWORD_POLICY_MESSAGE })
  password: string;

  @IsOptional()
  @IsIn(['ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR'])
  role?: string;

  @IsOptional()
  @IsString()
  fullName?: string;

  /** Si `true`, el usuario debe cambiar la contraseña temporal en su próximo ingreso. */
  @IsOptional()
  @IsBoolean()
  mustChangePassword?: boolean;
}
