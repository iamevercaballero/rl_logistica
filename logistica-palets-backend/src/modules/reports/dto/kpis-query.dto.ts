import { IsIn, IsOptional } from 'class-validator';

const ranges = ['today', 'week', 'month'] as const;

export class KpisQueryDto {
  @IsOptional()
  @IsIn(ranges)
  range?: (typeof ranges)[number];
}
