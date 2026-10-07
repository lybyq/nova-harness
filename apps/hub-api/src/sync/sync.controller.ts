import { Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SyncService } from './sync.service.js';

/** 提供全量、按类型、按来源同步以及同步历史查询的管理 API。 */
@ApiTags('sync')
@ApiBearerAuth()
@Controller('sync')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Post()
  runAll() {
    return this.sync.runAll();
  }

  @Post('npm')
  runNpm() {
    return this.sync.runType('npm');
  }

  @Post('gitlab')
  runGitLab() {
    return this.sync.runType('gitlab');
  }

  @Post('source/:id')
  runSource(@Param('id') id: string) {
    return this.sync.runSource(id);
  }

  @Get('runs')
  runs() {
    return this.sync.runs();
  }

  @Get('runs/:id')
  run(@Param('id') id: string) {
    return this.sync.run(id);
  }
}
