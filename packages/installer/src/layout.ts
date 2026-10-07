import { homedir } from 'node:os';
import { resolve } from 'node:path';
import type { StateIdentity } from '@nova-cbb/harness-contracts';

/** 跨平台 Harness 本地目录布局；允许测试或企业封装显式覆盖根目录。 */
export interface HarnessLayout {
  root: string;
  config: string;
  state: string;
  revisions: string;
  store: string;
  runtime: string;
  cache: string;
  logs: string;
  temp: string;
  lock: string;
}

/** 根据参数、环境变量和系统 home 依次选择根目录并返回绝对路径。 */
export function harnessLayout(
  root = process.env.NOVA_HARNESS_HOME ?? resolve(homedir(), '.nova-harness'),
): HarnessLayout {
  const absolute = resolve(root);
  return {
    root: absolute,
    config: resolve(absolute, 'config'),
    state: resolve(absolute, 'state'),
    revisions: resolve(absolute, 'state', 'revisions'),
    store: resolve(absolute, 'store'),
    runtime: resolve(absolute, 'runtimes'),
    cache: resolve(absolute, 'cache'),
    logs: resolve(absolute, 'logs'),
    temp: resolve(absolute, 'temp'),
    lock: resolve(absolute, '.apply.lock'),
  };
}

/** 把作用域 identity 编码成不含路径穿越字符的稳定目录键。 */
export function identityKey(identity: StateIdentity): string {
  return [identity.deploymentId, identity.runtimeId, identity.scope, identity.projectId ?? 'global']
    .map((part) => part.replace(/[^A-Za-z0-9._-]/g, '-'))
    .join('--');
}
