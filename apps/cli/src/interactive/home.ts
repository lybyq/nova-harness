import * as p from '@clack/prompts';

/** TTY 无参数时显示循环式首页；取消返回 undefined，非 TTY 由 main 输出 help。 */
export async function showHome(): Promise<string | undefined> {
  p.intro('Nova Harness · 内网 Agent 能力控制面');
  const action = await p.select({
    message: '请选择操作',
    options: [
      { value: 'doctor', label: '检查源站连接' },
      { value: 'hub-status', label: '查看 Hub 状态' },
      { value: 'search', label: '搜索能力' },
      { value: 'config-validate', label: '校验 Deployment Profile' },
      { value: 'exit', label: '退出' },
    ],
  });
  if (p.isCancel(action) || action === 'exit') {
    p.cancel('操作已取消，未修改任何配置');
    return undefined;
  }
  return action;
}
