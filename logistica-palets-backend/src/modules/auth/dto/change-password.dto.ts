import { IsString, Matches } from 'class-validator';
import { PASSWORD_PATTERN, PASSWORD_POLICY_MESSAGE } from '../../users/password-policy';

/** Self-service: el propio usuario autenticado cambia su contraseña. */
export class ChangePasswordDto {
  @IsString()
  currentPassword: string;

  @Matches(PASSWORD_PATTERN, { message: PASSWORD_POLICY_MESSAGE })
  newPassword: string;
}
