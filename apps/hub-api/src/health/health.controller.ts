import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/public.decorator.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** 提供包含 PostgreSQL 探针的公开容器健康端点。 */
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async health(): Promise<Record<string, unknown>> {
    await this.prisma.$queryRaw`SELECT 1`;
    return {
      status: 'healthy',
      service: 'nova-harness-hub',
      timestamp: new Date().toISOString(),
    };
  }
}
