import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/** 管理 Nest 生命周期中的 Prisma 单例，确保启动连接和关闭释放成对执行。 */
@Injectable()
/** 管理 Nest 生命周期的 Prisma 单例，确保启动连接和关闭释放成对执行。 */
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
