import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

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
  console.log(`Logistica palets API escuchando en puerto ${port}`);
}
void bootstrap();
