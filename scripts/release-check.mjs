import { spawnSync } from 'node:child_process';
import process from 'node:process';

const packages = [
  '@nova-cbb/harness-contracts',
  '@nova-cbb/harness-shared',
  '@nova-cbb/harness-core',
  '@nova-cbb/harness-installer',
  '@nova-cbb/harness-secrets',
  '@nova-cbb/source-gitlab',
  '@nova-cbb/source-npm',
  '@nova-cbb/runtime-claude-code',
  '@nova-cbb/harness-cli',
];

/**
 * 发布前按与 CI 相同的顺序执行质量门禁，再对全部公共 workspace 包做 dry-run pack。
 * 脚本不执行 npm publish，不读取 registry Token，因此可安全用于开发机和 CI。
 */
run(['run', 'prisma:generate']);
run(['run', 'format:check']);
run(['run', 'lint']);
run(['--workspace-concurrency=1', '-r', '--if-present', 'typecheck']);
run(['run', 'test']);
run(['run', 'test:coverage']);
run(['--workspace-concurrency=1', '-r', '--if-present', 'build']);
for (const name of packages) run(['--filter', name, 'pack', '--dry-run']);

function run(args) {
  const pnpmCli = process.env.npm_execpath;
  const command = pnpmCli ? process.execPath : process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  const commandArguments = pnpmCli ? [pnpmCli, ...args] : args;
  const result = spawnSync(command, commandArguments, { stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
