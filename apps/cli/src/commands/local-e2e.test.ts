import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { deploymentProfileSchema } from '@nova-cbb/harness-contracts';
import { FileStateStore } from '@nova-cbb/harness-installer';
import { describe, expect, it } from 'vitest';
import { EnvironmentSecrets } from '../config/environment-secrets.js';
import { HubClient } from '../hub/hub-client.js';
import { addCapability } from './capabilities.js';
import { applyLocalPlan, createLocalPlan, initializeLocal, stateIdentity } from './local-state.js';

describe('CLI 本地能力 E2E', () => {
  it('完成安装、Runtime 编译、Lock 和二次幂等 Plan', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nova-cli-e2e-'));
    const previousHome = process.env.NOVA_HARNESS_HOME;
    const previousApproval = process.env.NOVA_APPROVE_HIGH_RISK;
    const previousLocal = process.env.NOVA_ALLOW_LOCAL;
    process.env.NOVA_HARNESS_HOME = resolve(root, 'home');
    process.env.NOVA_APPROVE_HIGH_RISK = 'yes';
    try {
      const skill = resolve(root, 'skill-e2e');
      await mkdir(skill, { recursive: true });
      await writeFile(
        resolve(skill, 'SKILL.md'),
        '---\nname: skill-e2e\ndescription: CLI local E2E\n---\n\n# Skill\n',
      );
      const profile = deploymentProfileSchema.parse({
        apiVersion: 'harness.nova/v1',
        kind: 'DeploymentProfile',
        metadata: { id: 'local-e2e', displayName: 'Local E2E' },
        hub: { url: 'http://127.0.0.1:1/api/v1' },
        downloads: {
          allowedHosts: ['127.0.0.1'],
          allowedRedirectHosts: [],
          maxArchiveBytes: 1_000_000,
          maxExtractedBytes: 5_000_000,
          maxFiles: 100,
          allowLifecycleScripts: false,
        },
        sources: [
          {
            id: 'unused-npm',
            displayName: 'Unused',
            type: 'npm',
            registry: 'http://127.0.0.1:1',
            adapter: 'static-index',
            seedPackages: ['unused'],
          },
        ],
        runtime: { default: 'claude-code', mode: 'isolated' },
        trust: {
          allowUnreviewed: false,
          allowedMaintainerTeams: [],
          requireApprovalAt: 'high',
        },
      });
      const identity = stateIdentity(profile, 'user');
      const secrets = new EnvironmentSecrets();
      const hub = new HubClient(profile, secrets);
      await initializeLocal(profile, { scope: 'user', mode: 'isolated' });
      await addCapability(identity, skill, hub, { type: 'skill', allowUntrusted: true });
      const applied = await applyLocalPlan(profile, identity, hub, secrets);
      expect(applied.status).toBe('succeeded');
      const store = new FileStateStore();
      const actual = await store.readActual(identity);
      expect(actual.installed.map((item) => item.id)).toEqual(['skill-e2e']);
      const lock = JSON.parse(
        await readFile(resolve(store.stateDirectory(identity), 'harness.lock'), 'utf8'),
      ) as { kind: string; capabilities: unknown[] };
      expect(lock.kind).toBe('HarnessLock');
      expect(lock.capabilities).toHaveLength(1);
      expect((await createLocalPlan(identity)).operations).toEqual([]);
    } finally {
      restoreEnvironment('NOVA_HARNESS_HOME', previousHome);
      restoreEnvironment('NOVA_APPROVE_HIGH_RISK', previousApproval);
      restoreEnvironment('NOVA_ALLOW_LOCAL', previousLocal);
    }
  });
});

/** 精确恢复测试前环境变量，避免并行测试继承本地信任开关。 */
function restoreEnvironment(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
