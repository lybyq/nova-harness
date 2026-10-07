import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExecutionPlan, PlanOperation } from '@nova-cbb/harness-contracts';
import { checksumOf } from '@nova-cbb/harness-shared';
import { describe, expect, it } from 'vitest';
import { ApplyEngine, type OperationExecutor } from './apply-engine.js';
import { FileStateStore } from './state-store.js';

const identity = { deploymentId: 'test', runtimeId: 'claude-code', scope: 'user' } as const;
function plan(operations: PlanOperation[]): ExecutionPlan {
  return {
    id: 'plan-test',
    identity,
    createdAt: '2026-08-07T00:00:00.000Z',
    desiredChecksum: checksumOf('d'),
    actualChecksum: checksumOf('a'),
    catalogChecksum: checksumOf('c'),
    operations,
    warnings: [],
    requiredSecrets: [],
    breakingChanges: [],
  };
}

describe('ApplyEngine', () => {
  it('rolls back completed operations in reverse order', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nova-installer-'));
    const events: string[] = [];
    const executor: OperationExecutor = {
      async execute(operation) {
        events.push(`do:${operation.id}`);
        if (operation.id === 'op-0002') throw new Error('boom');
        return { operationId: operation.id };
      },
      async rollback(operation) {
        events.push(`undo:${operation.id}`);
      },
    };
    const operations: PlanOperation[] = [1, 2].map((index) => ({
      id: `op-000${index}`,
      type: 'write-runtime-config',
      target: 'claude-code',
      destructive: false,
      details: {},
    }));
    await expect(
      new ApplyEngine(new FileStateStore(root), executor).apply(plan(operations)),
    ).rejects.toMatchObject({ code: 'APPLY_FAILED' });
    expect(events).toEqual(['do:op-0001', 'do:op-0002', 'undo:op-0001']);
    const revisions = join(root, 'state', 'revisions');
    const [revision] = await readdir(revisions);
    expect(revision).toBeDefined();
    const result = JSON.parse(
      await readFile(join(revisions, revision!, 'result.json'), 'utf8'),
    ) as { status: string };
    expect(result.status).toBe('rolled-back');
  });
});
