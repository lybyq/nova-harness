import type { ExecutionPlan, PlanOperation } from '@nova-cbb/harness-contracts';
import { HarnessError, redact } from '@nova-cbb/harness-shared';
import { ProcessLock } from './lock.js';
import type { FileStateStore } from './state-store.js';

/** 单步 Apply 收据；rollbackData 必须可序列化且不得包含 Secret 明文。 */
export interface OperationReceipt {
  operationId: string;
  rollbackData?: unknown;
}
/** 领域无关的操作执行器，由 CLI 注入安装与 Runtime 写入实现。 */
export interface OperationExecutor {
  execute(operation: PlanOperation): Promise<OperationReceipt>;
  rollback(operation: PlanOperation, receipt: OperationReceipt): Promise<void>;
}

/** Apply 最终状态与完成的操作 ID。 */
export interface ApplyResult {
  revisionId: string;
  status: 'succeeded' | 'rolled-back' | 'rollback-failed';
  completed: string[];
}

/**
 * 在跨进程锁内执行 Journaled Apply：先建 Revision，成功保存 after，失败逆序回滚。
 * rollback-failed 会升级为独立错误，禁止调用方误认为状态已恢复。
 */
export class ApplyEngine {
  constructor(
    private readonly store: FileStateStore,
    private readonly executor: OperationExecutor,
  ) {}

  async apply(plan: ExecutionPlan): Promise<ApplyResult> {
    await this.store.initialize();
    const lock = new ProcessLock(this.store.layout.lock);
    await lock.acquire();
    const revision = await this.store.createRevision(plan);
    const completed: Array<{ operation: PlanOperation; receipt: OperationReceipt }> = [];
    try {
      for (const operation of plan.operations) {
        const receipt = await this.executor.execute(operation);
        completed.push({ operation, receipt });
        await this.store.writeRevisionFile(revision.directory, 'journal.json', {
          status: 'applying',
          completed: completed.map((item) => item.receipt),
        });
      }
      await this.store.writeRevisionFile(revision.directory, 'rollback.json', {
        operations: [...completed]
          .reverse()
          .map((item) => ({ operation: item.operation, receipt: item.receipt })),
      });
      await this.store.writeRevisionFile(revision.directory, 'result.json', {
        status: 'succeeded',
        finishedAt: new Date().toISOString(),
      });
      await this.store.snapshotRevisionState(revision.directory, 'after', plan.identity);
      return {
        revisionId: revision.id,
        status: 'succeeded',
        completed: completed.map((item) => item.operation.id),
      };
    } catch (error) {
      let rollbackFailed = false;
      for (const item of [...completed].reverse()) {
        try {
          await this.executor.rollback(item.operation, item.receipt);
        } catch {
          rollbackFailed = true;
        }
      }
      await this.store.writeRevisionFile(revision.directory, 'result.json', {
        status: rollbackFailed ? 'rollback-failed' : 'rolled-back',
        finishedAt: new Date().toISOString(),
        error: redact(
          error instanceof Error
            ? { name: error.name, message: error.message }
            : { type: typeof error },
        ),
      });
      if (rollbackFailed)
        throw new HarnessError({
          code: 'ROLLBACK_FAILED',
          message: 'Apply failed and rollback was incomplete',
          cause: error,
          details: { revisionId: revision.id },
        });
      throw new HarnessError({
        code: 'APPLY_FAILED',
        message: 'Apply failed; completed operations were rolled back',
        cause: error,
        details: { revisionId: revision.id },
      });
    } finally {
      await lock.release();
    }
  }
}
