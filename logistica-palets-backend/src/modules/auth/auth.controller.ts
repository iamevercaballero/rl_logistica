import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { UseGuards, Get, Req } from '@nestjs/common';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.username, dto.password);
  }
  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Req() req: any) {
    return req.user; 
  }
}
