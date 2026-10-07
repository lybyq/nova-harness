import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ResolveService } from './resolve.service.js';
/** 把角色与 Profile 覆盖解析为精确 Desired State 的 HTTP 入口。 */
@ApiTags('resolve')
@ApiBearerAuth()
@Controller('resolve')
export class ResolveController {
  constructor(private readonly resolver: ResolveService) {}
  @Post() resolve(@Body() body: unknown) {
    return this.resolver.resolve(body);
  }
}
