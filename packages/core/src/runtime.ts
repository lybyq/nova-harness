import type { PermissionRule, StateIdentity } from '@nova-cbb/harness-contracts';

/** Runtime Adapter 运行上下文；路径由 scope/mode 推导，Core 不感知 Claude 私有目录。 */
export interface RuntimeContext {
  identity: StateIdentity;
  mode: 'integrated' | 'isolated';
  userHome: string;
  projectDirectory?: string;
  isolatedRoot?: string;
}

/** Runtime 二进制探测结果，不包含用户配置内容。 */
export interface RuntimeDetection {
  installed: boolean;
  version?: string;
  command?: string;
  capabilities: string[];
}
/** 已安装并准备编译到 Runtime 的单个能力。 */
export interface ResolvedRuntimeCapability {
  id: string;
  type: string;
  enabled: boolean;
  storePath: string;
  command?: { executable: string; arguments: string[] };
  environment: Record<string, string>;
}
/** Runtime 编译输入，是 Desired State 与本地 Store 的无关运行时表示。 */
export interface RuntimeCompileInput {
  roleId: string;
  capabilities: ResolvedRuntimeCapability[];
  permissions: PermissionRule[];
}
/** 单个受管运行时制品；managedKeys 精确声明 ownership 边界。 */
export interface ManagedRuntimeFile {
  path: string;
  format: 'json' | 'markdown' | 'directory-link';
  content: unknown;
  managedKeys: string[];
  /** `remove` 仅允许删除带有 Nova ownership 标记的目录。 */
  operation?: 'write' | 'remove';
}
/** Adapter 编译结果；此阶段只计算，不写磁盘。 */
export interface CompiledRuntimeArtifacts {
  runtimeId: string;
  files: ManagedRuntimeFile[];
  warnings: string[];
}
/** Adapter 对当前磁盘状态的只读观测。 */
export interface ActualRuntimeState {
  runtimeId: string;
  files: Array<{ path: string; exists: boolean; content?: unknown }>;
}
/** Desired 编译产物与 Actual 观测的最小写入差异。 */
export interface RuntimePlan {
  runtimeId: string;
  writes: ManagedRuntimeFile[];
  warnings: string[];
}
/** Runtime 写入收据；changedFiles 与 backups 按索引一一对应，用于事务回滚。 */
export interface RuntimeApplyResult {
  changedFiles: string[];
  backups: string[];
}
/** Runtime 自检结果；unavailable 表示无法启动，degraded 表示可启动但存在风险。 */
export interface RuntimeHealthResult {
  status: 'healthy' | 'degraded' | 'unavailable';
  checks: Array<{ id: string; status: 'healthy' | 'degraded' | 'unavailable'; message: string }>;
}
/** 启动参数；环境只在子进程内生效，Adapter 不负责持久化。 */
export interface LaunchOptions {
  projectDirectory?: string;
  arguments?: string[];
  environment?: Record<string, string>;
}

/**
 * 多 Runtime 扩展接口。实现必须遵守 detect/inspect/compile/plan/apply 的纯度边界，
 * 并保证 apply 幂等、可回滚，launch 不通过 shell 字符串执行命令。
 */
export interface RuntimeAdapter {
  readonly id: string;
  readonly displayName: string;
  detect(): Promise<RuntimeDetection>;
  inspect(context: RuntimeContext): Promise<ActualRuntimeState>;
  compile(desired: RuntimeCompileInput, context: RuntimeContext): Promise<CompiledRuntimeArtifacts>;
  plan(desired: CompiledRuntimeArtifacts, actual: ActualRuntimeState): Promise<RuntimePlan>;
  apply(plan: RuntimePlan): Promise<RuntimeApplyResult>;
  doctor(context: RuntimeContext): Promise<RuntimeHealthResult>;
  launch(options: LaunchOptions, context: RuntimeContext): Promise<number>;
}
