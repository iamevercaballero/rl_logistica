import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { clientIp, requestId, userAgent } from '../../common/client-ip';
import { ChangePasswordDto } from './dto/change-password.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { PermissionsService } from '../permissions/permissions.service';
import type { UserRole } from '../users/entities/user.entity';

/** Max-age for the refresh-token cookie: 7 days in milliseconds */
const REFRESH_COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1_000;

/** Cookie name (matches what AuthService.refresh reads) */
const REFRESH_COOKIE = 'refreshToken';

/** Cookie path: only sent for auth-related endpoints */
const REFRESH_COOKIE_PATH = '/api/auth';

type AuthedRequest = Request & { user: { userId: string; username: string; role: UserRole } };

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
    private readonly permissions: PermissionsService,
  ) {}

  // ── Login ──────────────────────────────────────────────────────────────────

  /** Anti-brute-force: max 5 login attempts per minute per IP. */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
    @Req() req: Request,
  ) {
    // La identidad de red se resuelve acá y no en el servicio: el servicio no
    // tiene por qué saber de Express, y así queda probable con un objeto plano.
    const { access_token, refresh_token, user } = await this.auth.login(
      dto.username,
      dto.password,
      { ip: clientIp(req), userAgent: userAgent(req), requestId: requestId(req) },
    );

    // Store refresh token in an HttpOnly cookie — not accessible via JavaScript
    res.cookie(REFRESH_COOKIE, refresh_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
      maxAge: REFRESH_COOKIE_MAX_AGE,
      path: REFRESH_COOKIE_PATH,
    });

    // Return only the short-lived access token to the client
    return { access_token, user };
  }

  // ── Refresh ────────────────────────────────────────────────────────────────

  /**
   * Issues a new access token using the HttpOnly refresh token cookie.
   * Called automatically by the frontend axios interceptor on 401 errors.
   */
  @Post('refresh')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const refreshToken = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    const { access_token, refresh_token } = await this.auth.refresh(refreshToken, {
      ip: clientIp(req), userAgent: userAgent(req), requestId: requestId(req),
    });

    // Rotación: cada refresco entrega una cookie nueva y deja la anterior
    // inservible. Sin esto, el token viejo seguiría en el navegador y el
    // siguiente refresco lo presentaría como si fuera un reuso.
    res.cookie(REFRESH_COOKIE, refresh_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
      maxAge: REFRESH_COOKIE_MAX_AGE,
      path: REFRESH_COOKIE_PATH,
    });

    return { access_token };
  }

  // ── Logout ─────────────────────────────────────────────────────────────────

  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    // Revoca la sesión, no sólo la cookie: hasta acá cerrar sesión no cerraba
    // nada para quien tuviera una copia del token, que seguía sirviendo siete
    // días.
    await this.auth.logout(req.cookies?.[REFRESH_COOKIE] as string | undefined);
    res.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
    return { loggedOut: true };
  }

  // ── Cambio de contraseña propio ─────────────────────────────────────────────

  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  changePassword(@Body() dto: ChangePasswordDto, @Req() req: AuthedRequest) {
    return this.users.changeOwnPassword(req.user.userId, dto.currentPassword, dto.newPassword);
  }

  // ── Me ─────────────────────────────────────────────────────────────────────

  /**
   * Perfil completo del usuario autenticado + sus permisos efectivos
   * (plantilla del rol con sus overrides aplicados). El frontend debe usar
   * `permissions`, no `role === "..."`, para decidir qué mostrar — el backend
   * sigue siendo quien realmente autoriza cada operación.
   */
  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@Req() req: AuthedRequest) {
    const [profile, permissions] = await Promise.all([
      this.users.findOne(req.user.userId),
      this.permissions.getEffectivePermissions(req.user.userId, req.user.role),
    ]);
    return {
      userId: profile.id,
      username: profile.username,
      fullName: profile.fullName,
      role: profile.role,
      active: profile.active,
      mustChangePassword: profile.mustChangePassword,
      permissions,
    };
  }
}
