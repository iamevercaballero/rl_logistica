import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get()
  health() {
    return { ok: true, name: 'Logistica Palets API', time: new Date() };
  }
}
