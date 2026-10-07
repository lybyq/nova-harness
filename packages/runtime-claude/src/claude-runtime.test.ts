import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ClaudeCodeRuntimeAdapter } from './claude-runtime.js';

describe('ClaudeCodeRuntimeAdapter', () => {
  it('preserves user JSON fields and only adds managed fields', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nova-claude-'));
    await writeFile(
      join(root, '.claude.json'),
      JSON.stringify({ oauthAccount: { keep: true }, mcpServers: { personal: { command: 'x' } } }),
    );
    const context = {
      identity: { deploymentId: 'test', runtimeId: 'claude-code', scope: 'user' as const },
      mode: 'integrated' as const,
      userHome: root,
    };
    const adapter = new ClaudeCodeRuntimeAdapter();
    const compiled = await adapter.compile(
      {
        roleId: 'frontend',
        capabilities: [
          {
            id: 'jira',
            type: 'mcp',
            enabled: true,
            storePath: 'x',
            command: { executable: 'node', arguments: ['jira.js'] },
            environment: {},
          },
        ],
        permissions: [],
      },
      context,
    );
    await adapter.apply({ runtimeId: adapter.id, writes: compiled.files, warnings: [] });
    const result = JSON.parse(await readFile(join(root, '.claude.json'), 'utf8')) as {
      oauthAccount: unknown;
      mcpServers: Record<string, unknown>;
    };
    expect(result.oauthAccount).toEqual({ keep: true });
    expect(Object.keys(result.mcpServers)).toEqual(['personal', 'jira']);
  });

  it('is idempotent and refuses to replace an unowned skill directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nova-claude-idempotent-'));
    const store = join(root, 'store', 'skill-a');
    await mkdir(store, { recursive: true });
    await writeFile(join(store, 'SKILL.md'), '# A');
    const context = {
      identity: { deploymentId: 'test', runtimeId: 'claude-code', scope: 'user' as const },
      mode: 'integrated' as const,
      userHome: root,
    };
    const adapter = new ClaudeCodeRuntimeAdapter();
    const compiled = await adapter.compile(
      {
        roleId: 'frontend',
        capabilities: [
          { id: 'skill-a', type: 'skill', enabled: true, storePath: store, environment: {} },
        ],
        permissions: [],
      },
      context,
    );
    const target = join(root, '.claude', 'skills', 'skill-a');
    await mkdir(target, { recursive: true });
    await writeFile(join(target, 'user.txt'), 'keep');
    await expect(
      adapter.apply({ runtimeId: adapter.id, writes: compiled.files, warnings: [] }),
    ).rejects.toThrow(/不属于 Nova Harness/);
  });

  it('produces an empty second plan after applying managed JSON and skill links', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nova-claude-plan-'));
    const store = join(root, 'store', 'skill-a');
    await mkdir(store, { recursive: true });
    await writeFile(join(store, 'SKILL.md'), '# A');
    const context = {
      identity: { deploymentId: 'test', runtimeId: 'claude-code', scope: 'user' as const },
      mode: 'integrated' as const,
      userHome: root,
    };
    const adapter = new ClaudeCodeRuntimeAdapter();
    const compiled = await adapter.compile(
      {
        roleId: 'frontend',
        capabilities: [
          { id: 'skill-a', type: 'skill', enabled: true, storePath: store, environment: {} },
        ],
        permissions: [],
      },
      context,
    );
    await adapter.apply(await adapter.plan(compiled, await adapter.inspect(context)));
    const second = await adapter.plan(compiled, await adapter.inspect(context));
    expect(second.writes).toEqual([]);
  });
});
