import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminService } from './admin.service.js';
/** 暴露来源、能力版本、兼容性与审计等治理端点。 */
@ApiTags('admin')
@ApiBearerAuth()
@Controller()
export class AdminController {
  constructor(private readonly admin: AdminService) {}
  @Get('sources') sources() {
    return this.admin.sources();
  }
  @Put('sources/:id') updateSource(@Param('id') id: string, @Body() body: unknown) {
    return this.admin.updateSource(id, body);
  }
  @Post('sources/:id/test') testSource(@Param('id') id: string) {
    return this.admin.testSource(id);
  }
  @Put('capabilities/:id') updateCapability(@Param('id') id: string, @Body() body: unknown) {
    return this.admin.updateCapability(id, body);
  }
  @Post('capabilities/:id/versions/:version/recommend') recommend(
    @Param('id') id: string,
    @Param('version') version: string,
  ) {
    return this.admin.recommendVersion(id, version);
  }
  @Post('capabilities/:id/versions/:version/disable') disable(
    @Param('id') id: string,
    @Param('version') version: string,
  ) {
    return this.admin.disableVersion(id, version);
  }
  @Put('capabilities/:id/versions/:version/compatibility') compatibility(
    @Param('id') id: string,
    @Param('version') version: string,
    @Body() body: unknown,
  ) {
    return this.admin.updateCompatibility(id, version, body);
  }
  @Get('audit') audit() {
    return this.admin.audits();
  }
}
