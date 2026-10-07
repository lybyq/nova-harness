import { Controller, Get, Header, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { checksumOf } from '@nova-cbb/harness-shared';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service.js';

/** 为 Claude Code 输出带 ETag 的动态 Plugin Marketplace 清单。 */
@ApiTags('runtime')
@ApiBearerAuth()
@Controller('runtime/claude-code')
export class RuntimeController {
  constructor(private readonly prisma: PrismaService) {}
  @Get('marketplace.json')
  @Header('Cache-Control', 'private, max-age=60, must-revalidate')
  async marketplace(@Res({ passthrough: true }) response: Response) {
    const plugins = await this.prisma.capability.findMany({
      where: { type: 'PLUGIN', status: 'ACTIVE', deletedAt: null },
      include: { versions: { where: { recommended: true, deletedAt: null }, take: 1 } },
      orderBy: { id: 'asc' },
    });
    const payload = {
      name: 'nova-hub',
      owner: { name: 'Nova Harness' },
      plugins: plugins.map((plugin) => ({
        name: plugin.name,
        description: plugin.description,
        version: plugin.versions[0]?.version,
        source: plugin.sourceLocator,
      })),
    };
    response.setHeader('ETag', `"${checksumOf(payload)}"`);
    return payload;
  }
}
