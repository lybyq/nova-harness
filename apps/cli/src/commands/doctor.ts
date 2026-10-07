import { access, mkdir, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import {
  capabilitySchema,
  type DeploymentProfile,
  type StateIdentity,
} from '@nova-cbb/harness-contracts';
import { FileStateStore } from '@nova-cbb/harness-installer';
import { ClaudeCodeRuntimeAdapter } from '@nova-cbb/runtime-claude-code';
import { GitLabSource } from '@nova-cbb/source-gitlab';
import { NpmSource } from '@nova-cbb/source-npm';
import type { EnvironmentSecrets } from '../config/environment-secrets.js';
import type { HubClient } from '../hub/hub-client.js';

/** Source 层快速诊断的聚合结果；状态可直接稳定序列化给 CI。 */
export interface DoctorResult {
  status: 'healthy' | 'degraded';
  checks: Array<{
    sourceId: string;
    type: string;
    status: 'healthy' | 'auth-error' | 'permission-error' | 'connection-error';
    message: string;
  }>;
}

/**
 * 逐一探测启用的 GitLab/npm 来源并归一化鉴权、权限和连接错误。
 * @param profile 已校验的部署配置。
 * @param secrets 只在请求边界解析的 Secret 提供器。
 * @returns 不因单一 Source 失败而中止的诊断汇总。
 */
export async function doctorSources(
  profile: DeploymentProfile,
  secrets: EnvironmentSecrets,
): Promise<DoctorResult> {
  const checks: DoctorResult['checks'] = [];
  for (const source of profile.sources.filter((item) => item.enabled)) {
    try {
      if (source.type === 'gitlab') {
        await new GitLabSource({ config: source, secrets }).ping();
      } else {
        await new NpmSource({ config: source, secrets }).ping();
      }
      checks.push({
        sourceId: source.id,
        type: source.type,
        status: 'healthy',
        message: '连接正常',
      });
    } catch (error) {
      const code = isErrorCode(error) ? error.code : 'SOURCE_UNAVAILABLE';
      checks.push({
        sourceId: source.id,
        type: source.type,
        status:
          code === 'AUTH_INVALID'
            ? 'auth-error'
            : code === 'PERMISSION_DENIED'
              ? 'permission-error'
              : 'connection-error',
        message: error instanceof Error ? error.message : '未知错误',
      });
    }
  }
  return {
    status: checks.every((check) => check.status === 'healthy') ? 'healthy' : 'degraded',
    checks,
  };
}

/** 七层 Doctor 的单项机器可读检查记录。 */
export interface LayeredDoctorCheck {
  layer:
    'source' | 'installation' | 'configuration' | 'process' | 'protocol' | 'upstream' | 'runtime';
  id: string;
  status: 'healthy' | 'degraded' | 'unavailable' | 'disabled';
  message: string;
  fixable: boolean;
}

/**
 * 执行七层 Doctor。默认只做安全、快速检查；`deep` 会读取每个安装包入口和能力健康声明。
 * `fix` 只创建缺失目录和重建 Plan，不联网安装、不修改 Secret、不执行业务写操作。
 */
export async function doctorAll(
  profile: DeploymentProfile,
  identity: StateIdentity,
  secrets: EnvironmentSecrets,
  hub: HubClient,
  options: { capabilityId?: string; deep?: boolean; fix?: boolean } = {},
) {
  const checks: LayeredDoctorCheck[] = [];
  const store = new FileStateStore();
  if (options.fix) await store.initialize();
  try {
    await hub.health();
    checks.push({
      layer: 'source',
      id: 'hub',
      status: 'healthy',
      message: 'Hub 可达',
      fixable: false,
    });
  } catch (error) {
    checks.push({
      layer: 'source',
      id: 'hub',
      status: 'unavailable',
      message: error instanceof Error ? error.message : 'Hub 不可达',
      fixable: false,
    });
  }
  const sources = await doctorSources(profile, secrets);
  for (const item of sources.checks)
    checks.push({
      layer: 'source',
      id: item.sourceId,
      status: item.status === 'healthy' ? 'healthy' : 'unavailable',
      message: item.message,
      fixable: false,
    });
  const actual = await store.readActual(identity);
  const desired = await store.readDesired(identity);
  for (const installed of actual.installed.filter(
    (item) => !options.capabilityId || item.id === options.capabilityId,
  )) {
    const present = await exists(installed.storePath);
    checks.push({
      layer: 'installation',
      id: installed.id,
      status: present ? 'healthy' : 'unavailable',
      message: present ? `${installed.version} Store 存在` : `Store 缺失：${installed.storePath}`,
      fixable: !present,
    });
    if (options.deep && present) {
      const manifest = resolve(installed.storePath, 'package.json');
      const desiredItem = desired?.capabilities.find((item) => item.id === installed.id);
      const capability = await hub
        .capability(installed.id)
        .then((value) => capabilitySchema.parse(value))
        .catch(() => undefined);
      const protocolEnvironment: Record<string, unknown> = {
        ...(desiredItem?.configuration ?? {}),
      };
      for (const definition of capability?.secrets ?? []) {
        const value = await secrets.get(definition.key);
        if (value) protocolEnvironment[definition.key] = value;
      }
      const protocol =
        capability?.type === 'mcp'
          ? await probeMcpProtocol(installed.storePath, protocolEnvironment, 12_000)
          : {
              status: (await exists(manifest)) ? ('healthy' as const) : ('degraded' as const),
              message: (await exists(manifest))
                ? '能力入口 Manifest 可读'
                : '该能力不使用 npm package.json 协议入口',
            };
      checks.push({
        layer: 'protocol',
        id: installed.id,
        status: protocol.status,
        message: protocol.message,
        fixable: false,
      });
    }
  }
  for (const wanted of (desired?.capabilities ?? []).filter(
    (item) => !options.capabilityId || item.id === options.capabilityId,
  )) {
    try {
      const capability = capabilitySchema.parse(await hub.capability(wanted.id));
      const missingSecrets = [];
      for (const definition of capability.secrets.filter((item) => item.required))
        if (!(await secrets.has(definition.key))) missingSecrets.push(definition.key);
      const missingConfig = capability.configuration
        .filter((item) => item.required && wanted.configuration[item.key] === undefined)
        .map((item) => item.key);
      checks.push({
        layer: 'configuration',
        id: wanted.id,
        status: missingSecrets.length || missingConfig.length ? 'degraded' : 'healthy',
        message:
          missingSecrets.length || missingConfig.length
            ? `缺少 Secret: ${missingSecrets.join(', ') || '-'}；配置: ${missingConfig.join(', ') || '-'}`
            : '必需配置齐全',
        fixable: false,
      });
      const upstream = options.deep
        ? await probeUpstream(capability.sourceMetadata.healthChecks, profile)
        : undefined;
      checks.push({
        layer: 'upstream',
        id: wanted.id,
        status:
          upstream?.status ?? (capability.sourceMetadata.healthChecks ? 'degraded' : 'disabled'),
        message:
          upstream?.message ??
          (capability.sourceMetadata.healthChecks
            ? '健康声明存在；使用 --deep 执行只读探针'
            : '未声明 Upstream 健康检查'),
        fixable: false,
      });
    } catch (error) {
      checks.push({
        layer: 'configuration',
        id: wanted.id,
        status: 'unavailable',
        message: error instanceof Error ? error.message : 'Catalog 查询失败',
        fixable: false,
      });
    }
  }
  const runtimeContext = {
    identity,
    mode: profile.runtime.mode,
    userHome: process.env.USERPROFILE ?? process.env.HOME ?? '',
    ...(identity.projectId ? { projectDirectory: identity.projectId } : {}),
    isolatedRoot: resolve(store.layout.runtime, 'claude-code', 'isolated'),
  };
  const runtime = await new ClaudeCodeRuntimeAdapter().doctor(runtimeContext);
  for (const item of runtime.checks)
    checks.push({
      layer: item.id === 'binary' ? 'process' : 'runtime',
      id: item.id,
      status: item.status,
      message: item.message,
      fixable: item.id === 'mode',
    });
  if (options.fix && desired) {
    await mkdir(store.stateDirectory(identity), { recursive: true });
  }
  const severe = checks.some((item) => item.status === 'unavailable');
  const degraded = checks.some((item) => item.status === 'degraded');
  return { status: severe ? 'unavailable' : degraded ? 'degraded' : 'healthy', checks };
}

function isErrorCode(error: unknown): error is { code: string } {
  return error !== null && typeof error === 'object' && 'code' in error;
}

function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

/**
 * 以无 shell 子进程执行 MCP `initialize` 与 `tools/list` 两步只读探测。
 * 环境和响应正文不会写入日志；异常 Server 在超时后会被终止，避免 Doctor 悬挂。
 */
async function probeMcpProtocol(
  storePath: string,
  configuration: Record<string, unknown>,
  timeoutMs: number,
): Promise<{ status: 'healthy' | 'degraded' | 'unavailable'; message: string }> {
  let child: ReturnType<typeof spawn> | undefined;
  try {
    const pkg = JSON.parse(await readFile(resolve(storePath, 'package.json'), 'utf8')) as {
      bin?: string | Record<string, string>;
    };
    const entry =
      typeof pkg.bin === 'string' ? pkg.bin : pkg.bin ? Object.values(pkg.bin)[0] : undefined;
    if (!entry) return { status: 'unavailable', message: 'package.json 未声明 MCP 可执行入口' };
    child = spawn(process.execPath, [resolve(storePath, entry)], {
      cwd: storePath,
      windowsHide: true,
      shell: false,
      stdio: ['pipe', 'pipe', 'ignore'],
      env: {
        ...process.env,
        ...Object.fromEntries(
          Object.entries(configuration).filter(
            (item): item is [string, string] => typeof item[1] === 'string',
          ),
        ),
      },
    });
    const result = await new Promise<{ initialized: boolean; tools: boolean }>((accept, reject) => {
      let buffer = '';
      let initialized = false;
      const timer = setTimeout(() => reject(new Error('MCP 协议探针超时')), timeoutMs);
      child!.once('error', reject);
      child!.once('exit', (code) => {
        if (!initialized) reject(new Error(`MCP 进程提前退出：${String(code)}`));
      });
      child!.stdout!.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8');
        for (;;) {
          const index = buffer.indexOf('\n');
          if (index < 0) break;
          const line = buffer.slice(0, index).trim();
          buffer = buffer.slice(index + 1);
          if (!line.startsWith('{')) continue;
          const response = JSON.parse(line) as { id?: number; error?: unknown };
          if (response.error) return reject(new Error('MCP Server 返回协议错误'));
          if (response.id === 1) {
            initialized = true;
            child!.stdin!.write(
              `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`,
            );
            child!.stdin!.write(
              `${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })}\n`,
            );
          }
          if (response.id === 2) {
            clearTimeout(timer);
            accept({ initialized, tools: true });
          }
        }
      });
      child!.stdin!.write(
        `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'nova-doctor', version: '1.0.0' } } })}\n`,
      );
    });
    return result.initialized && result.tools
      ? { status: 'healthy', message: 'MCP initialize 与 tools/list 均成功' }
      : { status: 'degraded', message: 'MCP 协议响应不完整' };
  } catch (error) {
    return {
      status: 'unavailable',
      message: error instanceof Error ? error.message : 'MCP 协议探测失败',
    };
  } finally {
    child?.kill();
  }
}

/**
 * 执行 Manifest 声明的只读 HTTP 健康检查。只允许访问 Deployment 白名单主机，
 * 并拒绝 `safe: false` 声明，避免诊断过程触发业务写操作。
 */
async function probeUpstream(
  declarations: unknown,
  profile: DeploymentProfile,
): Promise<{ status: 'healthy' | 'degraded' | 'unavailable'; message: string } | undefined> {
  if (!Array.isArray(declarations) || declarations.length === 0) return undefined;
  const allowed = new Set([
    ...profile.downloads.allowedHosts,
    ...profile.downloads.allowedRedirectHosts,
  ]);
  for (const declaration of declarations) {
    if (!isRecord(declaration) || declaration.safe === false || declaration.type !== 'http')
      continue;
    const urlValue = isRecord(declaration.options) ? declaration.options.url : undefined;
    if (typeof urlValue !== 'string') continue;
    const url = new URL(urlValue);
    if (!allowed.has(url.hostname))
      return { status: 'degraded', message: `跳过非白名单健康地址：${url.hostname}` };
    try {
      const response = await fetch(url, {
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(Number(declaration.timeoutMs ?? 10_000)),
      });
      return response.ok
        ? { status: 'healthy', message: `只读健康探针返回 HTTP ${response.status}` }
        : { status: 'unavailable', message: `健康探针返回 HTTP ${response.status}` };
    } catch (error) {
      return {
        status: 'unavailable',
        message: error instanceof Error ? error.message : '健康探针失败',
      };
    }
  }
  return { status: 'degraded', message: '没有可安全执行的只读 Upstream 探针' };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
