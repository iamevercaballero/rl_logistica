import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsString, ValidateNested } from 'class-validator';
import { PermissionAction } from '../entities/role-permission.entity';
import { PermissionEffect } from '../entities/user-permission.entity';

const ACTIONS: PermissionAction[] = ['read', 'create', 'update', 'remove', 'approve'];

export class SetUserPermissionDto {
  @IsString()
  module: string;

  @IsIn(ACTIONS)
  action: PermissionAction;

  @IsIn(['ALLOW', 'DENY'])
  effect: PermissionEffect;
}

/** Body de `PUT /users/:id/permissions`: reemplaza el conjunto completo de overrides. */
export class SetUserPermissionsDto {
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => SetUserPermissionDto)
  overrides: SetUserPermissionDto[];
}
