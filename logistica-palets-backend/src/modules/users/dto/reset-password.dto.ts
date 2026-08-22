import { IsBoolean, IsOptional, Matches } from 'class-validator';
import { PASSWORD_PATTERN, PASSWORD_POLICY_MESSAGE } from '../password-policy';

export class ResetPasswordDto {
  @Matches(PASSWORD_PATTERN, { message: PASSWORD_POLICY_MESSAGE })
  newPassword: string;

  /** Default `true`: una contraseña que puso otra persona se cambia en el próximo ingreso. */
  @IsOptional()
  @IsBoolean()
  mustChangePassword?: boolean;
}
