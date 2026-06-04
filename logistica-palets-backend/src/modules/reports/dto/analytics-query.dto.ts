import { IsEnum, IsOptional } from 'class-validator';

export class AnalyticsQueryDto {
  @IsOptional()
  @IsEnum(['week', 'month'])
  range?: 'week' | 'month';
}
