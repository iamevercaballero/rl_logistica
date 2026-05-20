import { Module } from '@nestjs/common';
import { MailService } from './mail.service';
import { ReportsModule } from '../reports/reports.module';
import { AlertsModule } from '../alerts/alerts.module';

@Module({
  // DataSource is provided globally by TypeOrmModule.forRootAsync in AppModule
  imports: [ReportsModule, AlertsModule],
  providers: [MailService],
})
export class MailModule {}
