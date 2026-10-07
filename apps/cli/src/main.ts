#!/usr/bin/env node

import { Command } from 'commander';
import { capabilitySchema } from '@nova-cbb/harness-contracts';
import { EnvironmentSecrets } from './config/environment-secrets.js';
import { loadDeployment } from './config/load-deployment.js';
import { HubRegistryStore } from './config/hub-registry.js';
import { RuntimePreferenceStore } from './config/runtime-preference.js';
import { doctorAll } from './commands/doctor.js';
import { HubClient } from './hub/hub-client.js';
import { showHome } from './interactive/home.js';
import { Output } from './presenter/output.js';
import { importEnvFile, readSecretInput, testCapabilitySecrets } from './commands/secrets.js';
import {
  addCapability,
  checkUpdates,
  removeCapability,
  setCapabilityEnabled,
  updateCapability,
  updateAllCapabilities,
} from './commands/capabilities.js';
import {
  initializeProject,
  projectStatus,
  readProject,
  unlinkProject,
} from './commands/project.js';
import {
  cloneRole,
  createRoleDocument,
  currentRole,
  diffRole,
  editRole,
  useRole,
} from './commands/roles.js';
import {
  auditRecords,
  cacheStatus,
  cleanCache,
  completion,
  diffState,
  exportAudit,
  exportRuntime,
  exportState,
  importState,
  inspectState,
  listCapabilities,
  pruneStore,
  readLogs,
  runtimeOverview,
  verifyCache,
} from './commands/operations.js';
import {
  applyLocalPlan,
  createLocalPlan,
  initializeLocal,
  launchRuntime,
  localStatus,
  revisionHistory,
  revisionDetails,
  rollbackRevision,
  runtimeDoctor,
  setRoleDesired,
  stateIdentity,
} from './commands/local-state.js';

interface GlobalOptions {
  config?: string;
  json?: boolean;
  quiet?: boolean;
  color?: boolean;
  nonInteractive?: boolean;
  hub?: string;
  lang?: 'zh-CN' | 'en-US';
  verbose?: boolean;
  debug?: boolean;
  yes?: boolean;
  runtime?: string;
  scope?: 'user' | 'project' | 'local';
}

interface SearchOptions {
  type?: string;
  status?: string;
  page: string;
  pageSize: string;
  role?: string;
  tag?: string;
  runtime?: string;
}

interface SyncOptions {
  type?: 'gitlab' | 'npm';
}

interface ScopeOptions {
  scope: 'user' | 'project' | 'local';
  project?: string;
  mode?: 'integrated' | 'isolated';
}

const program = new Command()
  .name('nova')
  .description('Nova Harness CLI')
  .version('1.0.0')
  .option('--config <path>', 'Deployment Profile 路径')
  .option('--json', '仅输出机器可读 JSON')
  .option('--quiet', '只输出错误')
  .option('--no-color', '禁用颜色')
  .option('--non-interactive', '禁用交互提示')
  .option('--hub <name>', '覆盖当前 Hub 别名')
  .option('--runtime <id>', '覆盖当前 Runtime')
  .option('--scope <scope>', 'user|project|local');
program
  .option('--lang <locale>', 'zh-CN|en-US', 'zh-CN')
  .option('--verbose', '输出详细信息')
  .option('--debug', '输出调试信息')
  .option('--yes', '自动确认非破坏性操作');

program
  .command('config')
  .description('配置管理')
  .command('validate')
  .description('校验 Deployment Profile')
  .action(
    run(async ({ output, global }) => {
      const loaded = await loadDeployment(global.config);
      output.result({ valid: true, path: loaded.path, deployment: loaded.profile.metadata });
    }),
  );

const hub = program.command('hub').description('Hub 管理');
hub.command('list').action(
  run(async ({ output }) => {
    const registry = await new HubRegistryStore().read();
    output.result(
      Object.entries(registry.hubs).map(([name, value]) => ({
        name,
        ...value,
        active: registry.active === name,
      })),
    );
  }),
);
hub
  .command('add <name> <url>')
  .option('--auth-ref <ref>')
  .action(
    run(async ({ output }, name: string, url: string, options: { authRef?: string }) => {
      output.result(await new HubRegistryStore().add(name, url, options.authRef));
    }),
  );
hub.command('remove <name>').action(
  run(async ({ output }, name: string) => {
    output.result(await new HubRegistryStore().remove(name));
  }),
);
hub.command('use <name>').action(
  run(async ({ output }, name: string) => {
    output.result(await new HubRegistryStore().use(name));
  }),
);
hub.command('status').action(
  run(async ({ output, global, secrets }) => {
    const { profile } = await loadDeployment(global.config);
    output.result(await new HubClient(profile, secrets).health());
  }),
);
hub.command('sync').action(
  run(async ({ output, global, secrets }) => {
    const { profile } = await loadDeployment(global.config);
    output.result(await new HubClient(profile, secrets).sync());
  }),
);
hub.command('login').action(
  run(async ({ output, global, secrets }) => {
    const { profile } = await loadDeployment(global.config);
    if (!profile.hub.authRef) throw new Error('当前 Hub 未配置 authRef');
    const input = await readSecretInput(profile.hub.authRef);
    await secrets.set(profile.hub.authRef, input.value);
    output.result({ loggedIn: true, authRef: profile.hub.authRef });
  }),
);
hub.command('logout').action(
  run(async ({ output, global, secrets }) => {
    const { profile } = await loadDeployment(global.config);
    if (profile.hub.authRef) await secrets.delete(profile.hub.authRef);
    output.result({ loggedOut: true });
  }),
);

program
  .command('search [query]')
  .option('--type <type>', 'mcp|skill|plugin')
  .option('--status <status>', 'active|needs-review|disabled')
  .option('--role <id>', '按角色包含关系过滤')
  .option('--tag <tag>', '按标签过滤')
  .option('--runtime <id>', '按 Runtime 兼容性过滤')
  .option('--page <number>', '页码', '1')
  .option('--page-size <number>', '每页数量', '20')
  .action(
    run(async ({ output, global, secrets }, query: string | undefined, options: SearchOptions) => {
      const { profile } = await loadDeployment(global.config);
      const parameters = new URLSearchParams({
        page: options.page,
        pageSize: options.pageSize,
      });
      if (query) parameters.set('q', query);
      if (options.type) parameters.set('type', options.type);
      if (options.status) parameters.set('status', options.status);
      if (options.role) parameters.set('role', options.role);
      if (options.tag) parameters.set('tag', options.tag);
      if (options.runtime) parameters.set('runtime', options.runtime);
      output.result(await new HubClient(profile, secrets).catalog(parameters));
    }),
  );

program.command('info <id>').action(
  run(async ({ output, global, secrets }, id: string) => {
    const { profile } = await loadDeployment(global.config);
    output.result(await new HubClient(profile, secrets).capability(id));
  }),
);
program.command('versions <id>').action(
  run(async ({ output, global, secrets }, id: string) => {
    const { profile } = await loadDeployment(global.config);
    output.result(await new HubClient(profile, secrets).versions(id));
  }),
);
program.command('dependencies <id>').action(
  run(async ({ output, global, secrets }, id: string) => {
    const { profile } = await loadDeployment(global.config);
    output.result(await new HubClient(profile, secrets).dependencies(id));
  }),
);
program.command('compatibility <id>').action(
  run(async ({ output, global, secrets }, id: string) => {
    const { profile } = await loadDeployment(global.config);
    output.result(await new HubClient(profile, secrets).compatibility(id));
  }),
);

program
  .command('sync')
  .option('--type <type>', 'gitlab|npm')
  .action(
    run(async ({ output, global, secrets }, options: SyncOptions) => {
      const type = options.type;
      const { profile } = await loadDeployment(global.config);
      output.result(await new HubClient(profile, secrets).sync(type));
    }),
  );

program
  .command('doctor [capability]')
  .description('执行七层环境诊断')
  .option('--deep')
  .option('--fix')
  .option('--scope <scope>', 'user|project|local', 'user')
  .option('--project <path>')
  .action(
    run(
      async (
        { output, global, secrets },
        capability: string | undefined,
        options: ScopeOptions & { deep?: boolean; fix?: boolean },
      ) => {
        const { profile } = await loadDeployment(global.config);
        const identity = stateIdentity(profile, options.scope, options.project);
        const result = await doctorAll(
          profile,
          identity,
          secrets,
          new HubClient(profile, secrets),
          {
            ...(capability ? { capabilityId: capability } : {}),
            deep: options.deep ?? false,
            fix: options.fix ?? false,
          },
        );
        output.result(result);
        if (result.status !== 'healthy') process.exitCode = 9;
      },
    ),
  );

program
  .command('init')
  .description('初始化本地 Harness 状态')
  .option('--scope <scope>', 'user|project|local', 'user')
  .option('--project <path>')
  .option('--mode <mode>', 'integrated|isolated')
  .option('--role <id>', '初始化后解析并安装角色', 'frontend')
  .option('--runtime <id>', 'Runtime Adapter', 'claude-code')
  .action(
    run(
      async (
        { output, global, secrets },
        options: ScopeOptions & { role: string; runtime: string },
      ) => {
        const loaded = await loadDeployment(global.config);
        await new RuntimePreferenceStore().use(options.runtime, options.mode);
        const profile = {
          ...loaded.profile,
          runtime: {
            ...loaded.profile.runtime,
            default: options.runtime,
            mode: options.mode ?? loaded.profile.runtime.mode,
          },
        };
        const identity = stateIdentity(profile, options.scope, options.project);
        const initialized = await initializeLocal(profile, options);
        const plan = await setRoleDesired(identity, options.role, new HubClient(profile, secrets));
        const applied = plan.operations.length
          ? await applyLocalPlan(profile, identity, new HubClient(profile, secrets), secrets)
          : { status: 'succeeded', completed: [], revisionId: undefined };
        output.result({ initialized, role: options.role, plan, applied });
      },
    ),
  );

program
  .command('status')
  .description('显示 Desired/Actual 状态和漂移')
  .option('--scope <scope>', 'user|project|local', 'user')
  .option('--project <path>')
  .action(
    run(async ({ output, global }, options: ScopeOptions) => {
      const { profile } = await loadDeployment(global.config);
      output.result(await localStatus(stateIdentity(profile, options.scope, options.project)));
    }),
  );

program
  .command('plan')
  .description('生成并保存执行计划')
  .option('--scope <scope>', 'user|project|local', 'user')
  .option('--project <path>')
  .action(
    run(async ({ output, global }, options: ScopeOptions) => {
      const { profile } = await loadDeployment(global.config);
      output.result(await createLocalPlan(stateIdentity(profile, options.scope, options.project)));
    }),
  );
program
  .command('list')
  .option('--scope <scope>', 'user|project|local', 'user')
  .option('--project <path>')
  .action(
    run(async ({ output, global }, options: ScopeOptions) => {
      const { profile } = await loadDeployment(global.config);
      output.result(await listCapabilities(stateIdentity(profile, options.scope, options.project)));
    }),
  );
program
  .command('inspect')
  .option('--scope <scope>', 'user|project|local', 'user')
  .option('--project <path>')
  .action(
    run(async ({ output, global }, options: ScopeOptions) => {
      const { profile } = await loadDeployment(global.config);
      output.result(await inspectState(stateIdentity(profile, options.scope, options.project)));
    }),
  );
program
  .command('diff')
  .option('--scope <scope>', 'user|project|local', 'user')
  .option('--project <path>')
  .action(
    run(async ({ output, global }, options: ScopeOptions) => {
      const { profile } = await loadDeployment(global.config);
      output.result(await diffState(stateIdentity(profile, options.scope, options.project)));
    }),
  );

program
  .command('apply')
  .description('应用最近生成的执行计划')
  .option('--scope <scope>', 'user|project|local', 'user')
  .option('--project <path>')
  .action(
    run(async ({ output, global, secrets }, options: ScopeOptions) => {
      const { profile } = await loadDeployment(global.config);
      const identity = stateIdentity(profile, options.scope, options.project);
      output.result(
        await applyLocalPlan(profile, identity, new HubClient(profile, secrets), secrets),
      );
    }),
  );

const role = program.command('role').description('角色管理');
role.command('list').action(
  run(async ({ output, global, secrets }) => {
    const { profile } = await loadDeployment(global.config);
    output.result(await new HubClient(profile, secrets).roles());
  }),
);
role.command('show <id>').action(
  run(async ({ output, global, secrets }, id: string) => {
    const { profile } = await loadDeployment(global.config);
    output.result(await new HubClient(profile, secrets).role(id));
  }),
);
role
  .command('current')
  .option('--scope <scope>', 'user|project|local', 'user')
  .option('--project <path>')
  .action(
    run(async ({ output, global }, options: ScopeOptions) => {
      const { profile } = await loadDeployment(global.config);
      output.result(await currentRole(stateIdentity(profile, options.scope, options.project)));
    }),
  );
role
  .command('use <id>')
  .option('--dry-run')
  .option('--scope <scope>', 'user|project|local', 'user')
  .option('--project <path>')
  .action(
    run(
      async (
        { output, global, secrets },
        id: string,
        options: ScopeOptions & { dryRun?: boolean },
      ) => {
        const { profile } = await loadDeployment(global.config);
        const identity = stateIdentity(profile, options.scope, options.project);
        const client = new HubClient(profile, secrets);
        const plan = await useRole(identity, id, client);
        output.result(
          options.dryRun ? plan : await applyLocalPlan(profile, identity, client, secrets),
        );
      },
    ),
  );
role
  .command('diff <id>')
  .option('--scope <scope>', 'user|project|local', 'user')
  .option('--project <path>')
  .action(
    run(async ({ output, global, secrets }, id: string, options: ScopeOptions) => {
      const { profile } = await loadDeployment(global.config);
      output.result(
        await diffRole(
          stateIdentity(profile, options.scope, options.project),
          id,
          new HubClient(profile, secrets),
        ),
      );
    }),
  );
role.command('create <id>').action(
  run(async ({ output, global, secrets }, id: string) => {
    const { profile } = await loadDeployment(global.config);
    output.result(await new HubClient(profile, secrets).createRole(createRoleDocument(id)));
  }),
);
role.command('clone <source> <target>').action(
  run(async ({ output, global, secrets }, source: string, target: string) => {
    const { profile } = await loadDeployment(global.config);
    output.result(await cloneRole(source, target, new HubClient(profile, secrets)));
  }),
);
role
  .command('edit <id>')
  .requiredOption('--file <path>')
  .action(
    run(async ({ output, global, secrets }, id: string, options: { file: string }) => {
      const { profile } = await loadDeployment(global.config);
      output.result(await editRole(id, options.file, new HubClient(profile, secrets)));
    }),
  );
role.command('validate <id>').action(
  run(async ({ output, global, secrets }, id: string) => {
    const { profile } = await loadDeployment(global.config);
    output.result(await new HubClient(profile, secrets).validateRole(id));
  }),
);
role.command('publish <id>').action(
  run(async ({ output, global, secrets }, id: string) => {
    const { profile } = await loadDeployment(global.config);
    output.result(await new HubClient(profile, secrets).publishRole(id));
  }),
);
role
  .command('apply <id>')
  .option('--scope <scope>', 'user|project|local', 'user')
  .option('--project <path>')
  .action(
    run(async ({ output, global, secrets }, id: string, options: ScopeOptions) => {
      const { profile } = await loadDeployment(global.config);
      const identity = stateIdentity(profile, options.scope, options.project);
      const client = new HubClient(profile, secrets);
      await setRoleDesired(identity, id, client);
      output.result(await applyLocalPlan(profile, identity, client, secrets));
    }),
  );

const runtime = program.command('runtime').description('Runtime 管理');
runtime.command('list').action(
  run(async ({ output }) => {
    output.result([
      { id: 'claude-code', displayName: 'Claude Code', implemented: true },
      { id: 'pi', implemented: false },
      { id: 'opencode', implemented: false },
    ]);
  }),
);
for (const mode of ['detect', 'status', 'inspect'] as const)
  runtime
    .command(mode)
    .option('--scope <scope>', 'user|project|local', 'user')
    .option('--project <path>')
    .action(
      run(async ({ output, global }, options: ScopeOptions) => {
        const { profile } = await loadDeployment(global.config);
        output.result(
          await runtimeOverview(
            profile,
            stateIdentity(profile, options.scope, options.project),
            mode,
          ),
        );
      }),
    );
runtime.command('use <id>').action(
  run(async ({ output }, id: string) => {
    output.result(await new RuntimePreferenceStore().use(id));
  }),
);
runtime
  .command('export <path>')
  .option('--scope <scope>', 'user|project|local', 'user')
  .option('--project <path>')
  .action(
    run(async ({ output, global }, path: string, options: ScopeOptions) => {
      const { profile } = await loadDeployment(global.config);
      output.result(
        await exportRuntime(profile, stateIdentity(profile, options.scope, options.project), path),
      );
    }),
  );
runtime
  .command('doctor')
  .option('--scope <scope>', 'user|project|local', 'user')
  .option('--project <path>')
  .action(
    run(async ({ output, global }, options: ScopeOptions) => {
      const { profile } = await loadDeployment(global.config);
      output.result(
        await runtimeDoctor(profile, stateIdentity(profile, options.scope, options.project)),
      );
    }),
  );

program
  .command('launch')
  .description('启动配置后的 Runtime')
  .option('--scope <scope>', 'user|project|local', 'user')
  .option('--project <path>')
  .option('--role <id>')
  .option('--runtime <id>', 'Runtime Adapter', 'claude-code')
  .option('--dry-run', '只显示启动上下文，不创建进程')
  .allowUnknownOption(true)
  .argument('[args...]')
  .action(
    run(
      async (
        { output, global, secrets },
        args: string[],
        options: ScopeOptions & { role?: string; runtime: string; dryRun?: boolean },
      ) => {
        await new RuntimePreferenceStore().use(options.runtime);
        const { profile } = await loadDeployment(global.config);
        const identity = stateIdentity(profile, options.scope, options.project);
        if (options.role) {
          await setRoleDesired(identity, options.role, new HubClient(profile, secrets));
          await applyLocalPlan(profile, identity, new HubClient(profile, secrets), secrets);
        }
        if (options.dryRun) {
          output.result({ runtime: options.runtime, identity, arguments: args, spawn: false });
          return;
        }
        const code = await launchRuntime(profile, identity, args, secrets);
        output.result({ exitCode: code });
        process.exitCode = code;
      },
    ),
  );

const history = program
  .command('history')
  .description('列出 Apply Revision')
  .action(
    run(async ({ output }) => {
      output.result(await revisionHistory());
    }),
  );
history
  .command('show <revision>')
  .description('查看 Revision 详情')
  .action(
    run(async ({ output }, id: string) => {
      output.result(await revisionDetails(id));
    }),
  );
program
  .command('rollback [revision]')
  .description('恢复最近或指定 Revision')
  .action(
    run(async ({ output }, id?: string) => {
      output.result(await rollbackRevision(id));
    }),
  );

const secret = program.command('secret').description('安全管理 Secret');
secret
  .command('list')
  .description('仅列出已保存的键名')
  .action(
    run(async ({ output, secrets }) => {
      output.result((await secrets.list()).map((key) => ({ key, configured: true })));
    }),
  );
secret
  .command('set <key>')
  .description('从隐藏输入或 stdin 保存 Secret')
  .action(
    run(async ({ output, secrets }, key: string) => {
      const input = await readSecretInput(key);
      await secrets.set(key, input.value);
      output.result({ key, stored: true, whitespaceTrimmed: input.trimmed });
    }),
  );
secret.command('remove <key>').action(
  run(async ({ output, secrets }, key: string) => {
    await secrets.delete(key);
    output.result({ key, removed: true });
  }),
);
secret.command('import <env-file>').action(
  run(async ({ output, secrets }, path: string) => {
    output.result(await importEnvFile(path, secrets));
  }),
);
secret.command('test <capability>').action(
  run(async ({ output, global, secrets }, id: string) => {
    const { profile } = await loadDeployment(global.config);
    const capability = capabilitySchema.parse(await new HubClient(profile, secrets).capability(id));
    output.result(
      await testCapabilitySecrets(
        capability.secrets.filter((item) => item.required).map((item) => item.key),
        secrets,
      ),
    );
  }),
);

program
  .command('add <capability>')
  .option('--dry-run')
  .option('--type <type>', 'mcp|skill|plugin')
  .option('--allow-untrusted', '显式信任本地或未审核来源')
  .option('--scope <scope>', 'user|project|local', 'user')
  .option('--project <path>')
  .action(
    run(
      async (
        { output, global, secrets },
        specification: string,
        options: ScopeOptions & {
          dryRun?: boolean;
          type?: 'mcp' | 'skill' | 'plugin';
          allowUntrusted?: boolean;
        },
      ) => {
        const { profile } = await loadDeployment(global.config);
        const identity = stateIdentity(profile, options.scope, options.project);
        const client = new HubClient(profile, secrets);
        const plan = await addCapability(identity, specification, client, {
          ...(options.type ? { type: options.type } : {}),
          allowUntrusted: options.allowUntrusted ?? false,
        });
        output.result(
          options.dryRun ? plan : await applyLocalPlan(profile, identity, client, secrets),
        );
      },
    ),
  );
program
  .command('remove <capability>')
  .option('--dry-run')
  .option('--scope <scope>', 'user|project|local', 'user')
  .option('--project <path>')
  .action(
    run(
      async (
        { output, global, secrets },
        id: string,
        options: ScopeOptions & { dryRun?: boolean },
      ) => {
        const { profile } = await loadDeployment(global.config);
        const identity = stateIdentity(profile, options.scope, options.project);
        const plan = await removeCapability(identity, id);
        output.result(
          options.dryRun
            ? plan
            : await applyLocalPlan(profile, identity, new HubClient(profile, secrets), secrets),
        );
      },
    ),
  );
program
  .command('enable <capability>')
  .option('--dry-run')
  .option('--scope <scope>', 'user|project|local', 'user')
  .option('--project <path>')
  .action(
    run(
      async (
        { output, global, secrets },
        id: string,
        options: ScopeOptions & { dryRun?: boolean },
      ) => {
        const { profile } = await loadDeployment(global.config);
        const identity = stateIdentity(profile, options.scope, options.project);
        const plan = await setCapabilityEnabled(identity, id, true);
        output.result(
          options.dryRun
            ? plan
            : await applyLocalPlan(profile, identity, new HubClient(profile, secrets), secrets),
        );
      },
    ),
  );
program
  .command('disable <capability>')
  .option('--dry-run')
  .option('--scope <scope>', 'user|project|local', 'user')
  .option('--project <path>')
  .action(
    run(
      async (
        { output, global, secrets },
        id: string,
        options: ScopeOptions & { dryRun?: boolean },
      ) => {
        const { profile } = await loadDeployment(global.config);
        const identity = stateIdentity(profile, options.scope, options.project);
        const plan = await setCapabilityEnabled(identity, id, false);
        output.result(
          options.dryRun
            ? plan
            : await applyLocalPlan(profile, identity, new HubClient(profile, secrets), secrets),
        );
      },
    ),
  );
program
  .command('update [capability]')
  .option('--check')
  .option('--dry-run')
  .option('--role <id>', '按角色重新解析后更新')
  .option('--scope <scope>', 'user|project|local', 'user')
  .option('--project <path>')
  .action(
    run(
      async (
        { output, global, secrets },
        id: string | undefined,
        options: ScopeOptions & { check?: boolean; dryRun?: boolean; role?: string },
      ) => {
        const { profile } = await loadDeployment(global.config);
        const identity = stateIdentity(profile, options.scope, options.project);
        const client = new HubClient(profile, secrets);
        if (options.role) {
          const plan = await setRoleDesired(identity, options.role, client);
          output.result(
            options.check || options.dryRun
              ? plan
              : await applyLocalPlan(profile, identity, client, secrets),
          );
          return;
        }
        if (options.check || options.dryRun) output.result(await checkUpdates(identity, client));
        else {
          await (id
            ? updateCapability(identity, id, client)
            : updateAllCapabilities(identity, client));
          output.result(await applyLocalPlan(profile, identity, client, secrets));
        }
      },
    ),
  );

const project = program.command('project').description('项目级 Profile 管理');
project
  .command('init')
  .option('--role <id>', '初始角色', 'frontend')
  .option('--force')
  .action(
    run(async ({ output }, options: { role: string; force?: boolean }) => {
      output.result(await initializeProject(process.cwd(), options.role, options.force ?? false));
    }),
  );
project.command('status').action(
  run(async ({ output }) => {
    output.result(await projectStatus(process.cwd()));
  }),
);
project.command('apply').action(
  run(async ({ output, global, secrets }) => {
    const loaded = await readProject(process.cwd());
    const roleId = loaded.profile.extends[0]!.replace(/^roles\//, '');
    const { profile } = await loadDeployment(global.config);
    const identity = stateIdentity(profile, 'project', process.cwd());
    const storeStatus = await localStatus(identity);
    if (!storeStatus.desiredRole)
      await initializeLocal(profile, {
        scope: 'project',
        project: process.cwd(),
        mode: profile.runtime.mode,
      });
    const plan = await setRoleDesired(identity, roleId, new HubClient(profile, secrets));
    output.result({
      plan,
      applied: await applyLocalPlan(profile, identity, new HubClient(profile, secrets), secrets),
    });
  }),
);
project.command('unlink').action(
  run(async ({ output }) => {
    output.result(await unlinkProject(process.cwd()));
  }),
);
program
  .command('export [path]')
  .option('--include-lock')
  .option('--scope <scope>', 'user|project|local', 'user')
  .option('--project <path>')
  .action(
    run(
      async (
        { output, global },
        path: string | undefined,
        options: ScopeOptions & { includeLock?: boolean },
      ) => {
        const { profile } = await loadDeployment(global.config);
        output.result(
          await exportState(
            stateIdentity(profile, options.scope, options.project),
            path ?? 'harness-profile.yaml',
            options.includeLock ?? false,
          ),
        );
      },
    ),
  );
program
  .command('import <path>')
  .option('--scope <scope>', 'user|project|local', 'user')
  .option('--project <path>')
  .action(
    run(async ({ output, global }, path: string, options: ScopeOptions) => {
      const { profile } = await loadDeployment(global.config);
      output.result(
        await importState(stateIdentity(profile, options.scope, options.project), path),
      );
    }),
  );
const cache = program.command('cache').description('缓存管理');
cache.command('status').action(
  run(async ({ output }) => {
    output.result(await cacheStatus());
  }),
);
cache.command('verify').action(
  run(async ({ output }) => {
    output.result(await verifyCache());
  }),
);
cache.command('clean').action(
  run(async ({ output }) => {
    output.result(await cleanCache());
  }),
);
program.command('prune').action(
  run(async ({ output }) => {
    output.result(await pruneStore());
  }),
);
program
  .command('logs [capability]')
  .option('--tail <count>', '返回行数', '100')
  .option('--follow', '持续输出新增日志，Ctrl+C 安全结束')
  .action(
    run(
      async (
        { output },
        capability: string | undefined,
        options: { tail: string; follow?: boolean },
      ) => {
        const read = () => readLogs(Number(options.tail), capability);
        if (!options.follow) {
          output.result(await read());
          return;
        }
        let stopped = false;
        let previous = '';
        process.once('SIGINT', () => {
          stopped = true;
        });
        while (!stopped) {
          const current = await read();
          const serialized = JSON.stringify(current);
          if (serialized !== previous) output.result(current);
          previous = serialized;
          await new Promise((accept) => setTimeout(accept, 1_000));
        }
      },
    ),
  );
const audit = program.command('audit').description('审计记录');
audit.action(
  run(async ({ output }) => {
    output.result(await auditRecords());
  }),
);
audit.command('export [path]').action(
  run(async ({ output }, path?: string) => {
    output.result(await exportAudit(path ?? 'nova-audit.json'));
  }),
);
program.command('completion <shell>').action(
  run(async ({ output }, shell: 'bash' | 'zsh' | 'powershell') => {
    output.result(completion(shell));
  }),
);
program
  .command('exec <task...>')
  .option('--scope <scope>', 'user|project|local', 'user')
  .option('--project <path>')
  .action(
    run(async ({ output, global, secrets }, task: string[], options: ScopeOptions) => {
      const { profile } = await loadDeployment(global.config);
      const code = await launchRuntime(
        profile,
        stateIdentity(profile, options.scope, options.project),
        ['--print', task.join(' ')],
        secrets,
      );
      output.result({ exitCode: code });
      process.exitCode = code;
    }),
  );

async function main(): Promise<void> {
  if (process.argv.length === 2) {
    if (!process.stdin.isTTY) {
      program.outputHelp();
      return;
    }
    const action = await showHome();
    if (!action) return;
    const args =
      action === 'hub-status'
        ? ['hub', 'status']
        : action === 'config-validate'
          ? ['config', 'validate']
          : action === 'search'
            ? ['search']
            : [action];
    await program.parseAsync(['node', 'nova', ...args]);
    return;
  }
  await program.parseAsync(process.argv);
}

function run<T extends unknown[]>(
  action: (
    context: {
      output: Output;
      global: GlobalOptions;
      secrets: EnvironmentSecrets;
    },
    ...arguments_: T
  ) => Promise<void>,
) {
  return async (...arguments_: T): Promise<void> => {
    const global = program.opts<GlobalOptions>();
    if (global.hub) process.env.NOVA_HUB_NAME = global.hub;
    if (global.runtime) process.env.NOVA_RUNTIME_ID = global.runtime;
    if (global.scope) process.env.NOVA_SCOPE = global.scope;
    if (global.yes) process.env.NOVA_APPROVE_HIGH_RISK = 'yes';
    if (global.nonInteractive || process.env.CI) process.env.NOVA_NON_INTERACTIVE = 'yes';
    const output = new Output({
      json: global.json ?? false,
      quiet: global.quiet ?? false,
      color: global.color ?? true,
      ...(global.lang ? { locale: global.lang } : {}),
    });
    try {
      await action({ output, global, secrets: new EnvironmentSecrets() }, ...arguments_);
    } catch (error) {
      process.exitCode = output.error(error);
    }
  };
}

void main();
