import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

/** 在 Hub 内共享单个受生命周期管理的 Prisma 连接池。 */
@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
