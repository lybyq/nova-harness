import { open, rm, stat } from 'node:fs/promises';
import { HarnessError } from '@nova-cbb/harness-shared';

/**
 * 基于原子独占创建的跨进程 Apply 锁。锁记录 PID/时间，超时陈旧锁可安全接管；
 * release 只删除自己成功持有的锁，避免一个进程释放另一个进程的互斥状态。
 */
export class ProcessLock {
  #held = false;
  constructor(
    private readonly path: string,
    private readonly staleAfterMs = 30 * 60_000,
  ) {}

  async acquire(): Promise<void> {
    try {
      const handle = await open(this.path, 'wx', 0o600);
      await handle.writeFile(
        JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }),
      );
      await handle.close();
      this.#held = true;
    } catch (error) {
      if (!isExists(error)) throw error;
      const details = await stat(this.path).catch(() => undefined);
      if (details && Date.now() - details.mtimeMs > this.staleAfterMs) {
        await rm(this.path, { force: true });
        return this.acquire();
      }
      throw new HarnessError({
        code: 'PLAN_CONFLICT',
        message: 'Another Nova Harness apply is already running',
        hint: `Check ${this.path}; remove it only after confirming no apply process is active.`,
      });
    }
  }

  async release(): Promise<void> {
    if (this.#held) await rm(this.path, { force: true });
    this.#held = false;
  }
}

function isExists(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST';
}
