import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RolesService } from './roles.service.js';

/** 提供角色草稿、联合校验、版本读取与发布 API。 */
@ApiTags('roles')
@ApiBearerAuth()
@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}
  @Get() list() {
    return this.roles.list();
  }
  @Get(':id') get(@Param('id') id: string) {
    return this.roles.get(id);
  }
  @Post() create(@Body() body: unknown) {
    return this.roles.save(body);
  }
  @Put(':id') update(@Param('id') id: string, @Body() body: unknown) {
    return this.roles.save({
      ...(isRecord(body) ? body : {}),
      metadata: { ...(isRecord(body) && isRecord(body.metadata) ? body.metadata : {}), id },
    });
  }
  @Post(':id/validate') async validate(@Param('id') id: string, @Body() body: unknown) {
    return this.roles.validate(
      isRecord(body) && Object.keys(body).length ? body : await this.roles.get(id),
    );
  }
  @Post(':id/publish') publish(@Param('id') id: string) {
    return this.roles.publish(id);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
