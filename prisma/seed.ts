import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { roleProfileSchema } from '@nova-cbb/harness-contracts';
import { checksumOf } from '@nova-cbb/harness-shared';
import { PrismaClient, type Prisma } from '@prisma/client';
import { parse } from 'yaml';

const prisma = new PrismaClient();
const directory = resolve(process.cwd(), 'manifests', 'roles');

try {
  for (const file of (await readdir(directory)).filter((name) => name.endsWith('.yaml')).sort()) {
    const role = roleProfileSchema.parse(
      parse(await readFile(resolve(directory, file), 'utf8')) as unknown,
    );
    await prisma.role.upsert({
      where: { id: role.metadata.id },
      create: {
        id: role.metadata.id,
        displayName: role.metadata.displayName,
        description: role.metadata.description,
        published: true,
      },
      update: {
        displayName: role.metadata.displayName,
        description: role.metadata.description,
        published: true,
        deletedAt: null,
        rowVersion: { increment: 1 },
      },
    });
    await prisma.roleVersion.upsert({
      where: { roleId_version: { roleId: role.metadata.id, version: role.metadata.version } },
      create: {
        roleId: role.metadata.id,
        version: role.metadata.version,
        document: toJson(role),
        checksum: checksumOf(role),
        published: true,
      },
      update: { document: toJson(role), checksum: checksumOf(role), published: true },
    });
  }
} finally {
  await prisma.$disconnect();
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
