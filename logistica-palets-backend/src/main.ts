import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';

async function bootstrap() {
  // bufferLogs: true ensures Pino captures early boot messages
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // Replace NestJS default logger with Pino
  app.useLogger(app.get(Logger));

  // Parse cookies (needed for HttpOnly refresh token)
  app.use(cookieParser());

  // Security HTTP headers (HSTS, X-Frame-Options, X-Content-Type-Options, etc.)
  app.use(helmet());

  app.setGlobalPrefix('api');

  // CORS: en producción restringido a CORS_ORIGIN (lista separada por coma);
  // si la variable está vacía (dev), se refleja cualquier origen.
  const corsOrigin = process.env.CORS_ORIGIN?.trim();
  app.enableCors(
    corsOrigin
      ? { origin: corsOrigin.split(',').map((o) => o.trim()), credentials: true }
      : { origin: true, credentials: true },
  );

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = process.env.PORT || 3000;
  await app.listen(port);
  app.get(Logger).log(`RL Logística API escuchando en puerto ${port}`, 'Bootstrap');
}
void bootstrap();
