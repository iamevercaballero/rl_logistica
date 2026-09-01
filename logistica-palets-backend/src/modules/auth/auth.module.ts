import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { UsersModule } from '../users/users.module';
import { AuthEvent } from './entities/auth-event.entity';
import { RefreshSession } from './entities/refresh-session.entity';
import { RefreshSessionCleanupService } from './refresh-session-cleanup.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([AuthEvent, RefreshSession]),
    UsersModule,
    ConfigModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: (config.get<string>('JWT_SECRET') || 'dev_secret_fallback'),
        signOptions: {
          expiresIn: config.get<string>('JWT_EXPIRES_IN', '8h') as any,
        },
      }),
    }),
  ],
  providers: [AuthService, JwtStrategy, RefreshSessionCleanupService],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}
