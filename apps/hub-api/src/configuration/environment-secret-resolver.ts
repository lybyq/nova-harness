import { Injectable } from '@nestjs/common';

/** Hub 只按 authRef 从部署环境读取来源凭证，任何值都不会写入数据库。 */
@Injectable()
/** Hub 仅从部署环境按 authRef 读取来源凭据，不写数据库。 */
export class EnvironmentSecretResolver {
  get(reference: string): Promise<string | undefined> {
    const normalized = `NOVA_SECRET_${reference.replace(/[^A-Za-z0-9]/g, '_').toUpperCase()}`;
    return Promise.resolve(process.env[reference] ?? process.env[normalized]);
  }
}
