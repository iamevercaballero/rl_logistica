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
import { JwtAuthGuard } from './guards/jwt-auth.guard';

/** Max-age for the refresh-token cookie: 7 days in milliseconds */
const REFRESH_COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1_000;

/** Cookie name (matches what AuthService.refresh reads) */
const REFRESH_COOKIE = 'refreshToken';

/** Cookie path: only sent for auth-related endpoints */
const REFRESH_COOKIE_PATH = '/api/auth';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // ── Login ──────────────────────────────────────────────────────────────────

  /** Anti-brute-force: max 5 login attempts per minute per IP. */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { access_token, refresh_token, user } = await this.auth.login(
      dto.username,
      dto.password,
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
  async refresh(@Req() req: Request) {
    const refreshToken = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    return this.auth.refresh(refreshToken);
  }

  // ── Logout ─────────────────────────────────────────────────────────────────

  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
    return { loggedOut: true };
  }

  // ── Me ─────────────────────────────────────────────────────────────────────

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Req() req: Request) {
    return (req as any).user;
  }
}
