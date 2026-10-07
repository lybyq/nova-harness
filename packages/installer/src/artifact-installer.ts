import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import {
  access,
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, isAbsolute, normalize, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import { spawn } from 'node:child_process';
import type { Capability, CapabilityVersion, DeploymentProfile } from '@nova-cbb/harness-contracts';
import { checksumOf, HarnessError } from '@nova-cbb/harness-shared';
import * as tar from 'tar';
import type { HarnessLayout } from './layout.js';

/** 安装成功后写入 Actual State 的非敏感收据。 */
export interface InstallReceipt {
  storePath: string;
  integrity?: string;
  command?: { executable: string; arguments: string[] };
}
/** 安装器只按引用读取密钥，不允许枚举或持久化明文。 */
export interface InstallerSecrets {
  get(reference: string): Promise<string | undefined>;
}

/**
 * 下载并验证不可变能力制品的事务型安装器。
 * 网络内容始终先进入临时目录，完成完整性、路径、规模和入口校验后才原子移动到 Store。
 */
export class ArtifactInstaller {
  constructor(
    private readonly layout: HarnessLayout,
    private readonly profile: DeploymentProfile,
    private readonly secrets: InstallerSecrets,
  ) {}

  async install(capability: Capability, version: CapabilityVersion): Promise<InstallReceipt> {
    if (capability.source.kind === 'local') return this.#installLocal(capability, version);
    if (!version.artifact)
      throw new HarnessError({
        code: 'CONFIG_INVALID',
        message: `${capability.id}@${version.version} has no downloadable artifact`,
      });
    const safeId = capability.id.replace(/[^A-Za-z0-9._-]/g, '-');
    const storePath = resolve(
      this.layout.store,
      capability.source.kind === 'npm' ? 'npm' : 'git',
      safeId,
      version.version,
    );
    if (await exists(storePath)) return this.#receipt(capability, storePath, version.integrity);
    const temporary = resolve(
      this.layout.temp,
      `${safeId}-${version.version}-${process.pid}-${Date.now()}`,
    );
    const archive = resolve(temporary, 'artifact.tgz');
    const extracted = resolve(temporary, 'package');
    await mkdir(extracted, { recursive: true });
    try {
      const headers = await this.#headers(capability.source.sourceId);
      const digest = await this.#download(version.artifact.url, archive, headers);
      this.#verifyIntegrity(version, digest);
      let entryCount = 0;
      let extractedBytes = 0;
      const extractedLimit = this.profile.downloads.maxExtractedBytes;
      await tar.x({
        file: archive,
        cwd: extracted,
        strip: 1,
        preservePaths: false,
        filter: (path) => !isIgnoredArchivePath(path),
        onentry: (entry) => {
          assertArchivePath(entry.path);
          entryCount += 1;
          extractedBytes += entry.size;
          if (entryCount > this.profile.downloads.maxFiles || extractedBytes > extractedLimit)
            throw new HarnessError({
              code: 'INTEGRITY_FAILED',
              message: '解压内容超过文件数量或展开大小安全上限',
            });
        },
      });
      await this.#validate(capability, version, extracted, version.artifact.entryPath);
      if (capability.source.kind === 'npm')
        await this.#installProductionDependencies(extracted, capability.source.sourceId);
      const storeChecksum = await directoryChecksum(extracted);
      await writeFile(
        resolve(extracted, '.nova-store.json'),
        `${JSON.stringify({ capabilityId: capability.id, version: version.version, checksum: storeChecksum }, null, 2)}\n`,
        { encoding: 'utf8', mode: 0o600 },
      );
      await mkdir(dirname(storePath), { recursive: true });
      await rename(extracted, storePath);
      return this.#receipt(capability, storePath, version.integrity);
    } catch (error) {
      if (error instanceof HarnessError) throw error;
      throw new HarnessError({
        code: 'APPLY_FAILED',
        message: `Failed to install ${capability.id}@${version.version}`,
        cause: error,
      });
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }

  /**
   * 安装用户显式批准的本地 Skill/Plugin。仍复制到不可变 Store 并生成内容摘要，
   * 后续启动不依赖原目录；不执行任何安装脚本。
   */
  async #installLocal(capability: Capability, version: CapabilityVersion): Promise<InstallReceipt> {
    const source = resolve(capability.source.locator);
    if (!(await exists(source)))
      throw new HarnessError({ code: 'NOT_FOUND', message: `本地能力目录不存在：${source}` });
    const safeId = capability.id.replace(/[^A-Za-z0-9._-]/g, '-');
    const storePath = resolve(this.layout.store, 'local', safeId, version.version);
    if (await exists(storePath)) return this.#receipt(capability, storePath);
    const temporary = resolve(this.layout.temp, `${safeId}-local-${process.pid}-${Date.now()}`);
    try {
      await cp(source, temporary, {
        recursive: true,
        filter: (path) => !isIgnoredArchivePath(path),
      });
      await this.#validate(capability, version, temporary);
      await writeFile(
        resolve(temporary, '.nova-store.json'),
        `${JSON.stringify({ capabilityId: capability.id, version: version.version, checksum: await directoryChecksum(temporary) }, null, 2)}\n`,
        { encoding: 'utf8', mode: 0o600 },
      );
      await mkdir(dirname(storePath), { recursive: true });
      await rename(temporary, storePath);
      return this.#receipt(capability, storePath);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }

  async #headers(sourceId: string): Promise<Headers> {
    const source = this.profile.sources.find((item) => item.id === sourceId);
    const headers = new Headers({ Accept: 'application/octet-stream' });
    if (source?.authRef) {
      const token = await this.secrets.get(source.authRef);
      if (!token)
        throw new HarnessError({
          code: 'AUTH_REQUIRED',
          message: `Missing source secret: ${source.authRef}`,
        });
      headers.set(
        source.type === 'gitlab' ? 'PRIVATE-TOKEN' : 'Authorization',
        source.type === 'gitlab' ? token : `Bearer ${token}`,
      );
    }
    return headers;
  }

  async #download(rawUrl: string, target: string, headers: Headers): Promise<Map<string, string>> {
    let url = new URL(rawUrl);
    const allowed = new Set([
      ...this.profile.downloads.allowedHosts,
      ...this.profile.downloads.allowedRedirectHosts,
    ]);
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      if (!allowed.has(url.hostname))
        throw new HarnessError({
          code: 'UNTRUSTED_SOURCE',
          message: `Artifact host is not allowlisted: ${url.hostname}`,
        });
      const response = await fetch(url, {
        headers,
        redirect: 'manual',
        signal: AbortSignal.timeout(120_000),
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location)
          throw new HarnessError({
            code: 'SOURCE_UNAVAILABLE',
            message: `Artifact redirect from ${url.hostname} had no location`,
          });
        url = new URL(location, url);
        continue;
      }
      if (!response.ok || !response.body)
        throw new HarnessError({
          code: 'SOURCE_UNAVAILABLE',
          message: `Artifact download failed with HTTP ${response.status}`,
        });
      const digests = new Map([
        ['sha512', createHash('sha512')],
        ['sha256', createHash('sha256')],
        ['sha1', createHash('sha1')],
      ]);
      let bytes = 0;
      const meter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          bytes += chunk.length;
          if (bytes > thisLimit)
            return callback(
              new HarnessError({
                code: 'INTEGRITY_FAILED',
                message: 'Artifact exceeds the configured archive size limit',
              }),
            );
          for (const hash of digests.values()) hash.update(chunk);
          callback(null, chunk);
        },
      });
      const thisLimit = this.profile.downloads.maxArchiveBytes;
      await pipeline(
        Readable.fromWeb(response.body as never),
        meter,
        createWriteStream(target, { mode: 0o600 }),
      );
      return new Map([...digests].map(([name, hash]) => [name, hash.digest('base64')]));
    }
    throw new HarnessError({
      code: 'SOURCE_UNAVAILABLE',
      message: 'Artifact download exceeded redirect limit',
    });
  }

  #verifyIntegrity(version: CapabilityVersion, digests: Map<string, string>): void {
    if (version.integrity) {
      const candidates = version.integrity.split(/\s+/).map((value) => value.split('-', 2));
      if (
        !candidates.some(
          ([algorithm, expected]) => expected && digests.get(algorithm ?? '') === expected,
        )
      )
        throw new HarnessError({
          code: 'INTEGRITY_FAILED',
          message: 'Registry integrity verification failed',
        });
    }
    if (
      version.archiveSha256 &&
      digests.get('sha256') !== Buffer.from(version.archiveSha256, 'hex').toString('base64')
    )
      throw new HarnessError({
        code: 'INTEGRITY_FAILED',
        message: 'Archive SHA-256 verification failed',
      });
  }

  async #validate(
    capability: Capability,
    version: CapabilityVersion,
    directory: string,
    entryPath?: string,
  ): Promise<void> {
    const required =
      capability.type === 'skill'
        ? 'SKILL.md'
        : capability.type === 'plugin'
          ? '.claude-plugin/plugin.json'
          : capability.source.kind === 'npm'
            ? 'package.json'
            : entryPath;
    if (required && !(await exists(resolveInside(directory, required))))
      throw new HarnessError({
        code: 'INTEGRITY_FAILED',
        message: `${capability.id} archive is missing ${required}`,
      });
    if (capability.type === 'skill') {
      const content = await readFile(resolveInside(directory, 'SKILL.md'), 'utf8');
      const frontmatter = /^---\s*\r?\n([\s\S]*?)\r?\n---/.exec(content)?.[1];
      if (
        !frontmatter ||
        !/^name\s*:\s*\S+/m.test(frontmatter) ||
        !/^description\s*:\s*.+/m.test(frontmatter)
      )
        throw new HarnessError({
          code: 'INTEGRITY_FAILED',
          message: `${capability.id} 的 SKILL.md 缺少 name/description frontmatter`,
        });
    }
    if (capability.type === 'plugin') {
      const raw = JSON.parse(
        await readFile(resolveInside(directory, '.claude-plugin/plugin.json'), 'utf8'),
      ) as unknown;
      if (!isRecord(raw) || typeof raw.name !== 'string' || raw.name.trim() === '')
        throw new HarnessError({
          code: 'INTEGRITY_FAILED',
          message: `${capability.id} 的 plugin.json 缺少有效 name`,
        });
    }
    const manifest = resolve(directory, 'nova.manifest.yaml');
    if (capability.source.kind === 'gitlab' && (await exists(manifest))) {
      const actual = checksumOf(await readFile(manifest, 'utf8'));
      if (actual !== version.manifestChecksum)
        throw new HarnessError({
          code: 'INTEGRITY_FAILED',
          message: `${capability.id} Manifest checksum 校验失败`,
        });
    }
  }

  async #installProductionDependencies(directory: string, sourceId: string): Promise<void> {
    const source = this.profile.sources.find((item) => item.id === sourceId && item.type === 'npm');
    if (!source || source.type !== 'npm')
      throw new HarnessError({
        code: 'CONFIG_INVALID',
        message: `npm source ${sourceId} is not configured`,
      });
    const executable = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const args = [
      'install',
      '--omit=dev',
      '--no-package-lock',
      '--no-audit',
      '--no-fund',
      '--registry',
      source.registry,
    ];
    if (!this.profile.downloads.allowLifecycleScripts) args.push('--ignore-scripts');
    await run(executable, args, directory, 10 * 60_000);
  }

  async #receipt(
    capability: Capability,
    storePath: string,
    integrity?: string,
  ): Promise<InstallReceipt> {
    if (capability.source.kind !== 'npm') return { storePath, ...(integrity ? { integrity } : {}) };
    const pkg = JSON.parse(await readFile(resolve(storePath, 'package.json'), 'utf8')) as {
      bin?: string | Record<string, string>;
    };
    const entry =
      typeof pkg.bin === 'string' ? pkg.bin : pkg.bin ? Object.values(pkg.bin)[0] : undefined;
    if (!entry)
      throw new HarnessError({
        code: 'INTEGRITY_FAILED',
        message: `${capability.id} package does not expose a bin entry`,
      });
    return {
      storePath,
      ...(integrity ? { integrity } : {}),
      command: { executable: process.execPath, arguments: [resolveInside(storePath, entry)] },
    };
  }
}

function assertArchivePath(path: string): void {
  const normalized = normalize(path);
  if (isAbsolute(normalized) || normalized === '..' || normalized.startsWith(`..${sep}`))
    throw new HarnessError({ code: 'INTEGRITY_FAILED', message: `Unsafe archive entry: ${path}` });
}

/** 丢弃版本库元数据和典型构建缓存，减少 Store 污染与恶意压缩包展开面。 */
function isIgnoredArchivePath(path: string): boolean {
  return /(^|\/)(\.git|\.svn|node_modules|dist\/\.cache|\.cache)(\/|$)/.test(
    path.replaceAll('\\', '/'),
  );
}

function resolveInside(root: string, path: string): string {
  const target = resolve(root, path);
  if (target !== root && !target.startsWith(`${root}${sep}`))
    throw new HarnessError({
      code: 'INTEGRITY_FAILED',
      message: `Path escapes installation root: ${basename(path)}`,
    });
  return target;
}
async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}
function run(command: string, args: string[], cwd: string, timeout: number): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'ignore', windowsHide: true });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${command} timed out`));
    }, timeout);
    child.once('error', reject);
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} exited with code ${String(code)}`));
    });
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 计算展开后 Store 的稳定摘要，覆盖相对路径、文件大小和内容。
 * ownership 文件本身被排除，以避免摘要自引用；目录顺序统一排序以保证跨平台一致。
 */
async function directoryChecksum(root: string): Promise<string> {
  const hash = createHash('sha256');
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.name === '.nova-store.json') continue;
      const path = resolve(directory, entry.name);
      const relativePath = path.slice(root.length + 1).replaceAll('\\', '/');
      if (entry.isDirectory()) {
        hash.update(`d:${relativePath}\n`);
        await visit(path);
      } else if (entry.isFile()) {
        const details = await stat(path);
        hash.update(`f:${relativePath}:${details.size}\n`);
        hash.update(await readFile(path));
      }
    }
  };
  await visit(root);
  return hash.digest('hex');
}
