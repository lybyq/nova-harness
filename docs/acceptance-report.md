# Nova Harness 1.0 验收报告

验收日期：2026-08-08  
工程目录：`E:\ai\nova-harness`

## 结论

原始 1.0 清单的代码、配置、管理端、确定性环境、发布门禁和 npm 制品已经交付。Hub 默认开放访问，Admin 无登录页；换另一套内网时复制 Deployment Profile，替换地址、网络、信任与可选 Secret 引用即可。

## 自动化证据

| 检查                 | 结果                                                                             |
| -------------------- | -------------------------------------------------------------------------------- |
| `pnpm release:check` | 通过：Prettier、ESLint、12 个 workspace TypeScript、测试、全量构建、9 包 dry-run |
| 确定性测试           | 12 个文件、37/37 通过                                                            |
| Harness Core 覆盖率  | 行 94.75%、分支 90.69%，超过 85%/80% 门槛                                        |
| 公网真源             | GitLab Group API 与 npm Registry 2/2 通过                                        |
| 中文 JSDoc 审计      | 导出 TypeScript 声明无缺失                                                       |
| 浏览器验收           | 桌面与 390×844 移动端通过，控制台 error/warn 为 0                                |
| npm 制品             | 9 个 `1.0.0` `.tgz` 已生成到 `artifacts/`                                        |

## Compose 集成证据

1. PostgreSQL 17 健康，Prisma migration 和七类 Role seed 成功。
2. Mock GitLab/npm 服务健康；健康检查固定使用 IPv4 回环，避免 Alpine `localhost` 的 IPv6误判。
3. Hub API 在无 Authorization Header 时 `/health`、`/catalog`、`POST /sync` 均成功。
4. GitLab 同步发现 3 项、npm 同步发现 1 项，失败数均为 0；Catalog 总数为 4。
5. Hub Admin 返回 HTTP 200，可直接进入首页；首页搜索 `mock` 跳到 `/catalog?q=mock` 并展示 4 项。
6. 宿主机 CLI 使用无 `authRef` 的 Mock Profile 可匿名执行 `hub status` 和 `search mock`。

## 发布制品

`artifacts/` 包含 contracts、shared、core、installer、secrets、GitLab/npm source、Claude Code runtime 和 CLI 九个包。CLI tarball 已检查，所有 `workspace:*` 依赖均转换为 `1.0.0`，可以上传到另一套内网 npm 仓库。

## 接入目标内网前的最后动作

1. 复制 `manifests/deployments/internal.example.yaml` 并替换真实地址与网络策略。
2. 开放 Hub 删除 `hub.authRef`；鉴权 Hub 保留引用并注入 Token。
3. 将待映射 Role 能力 ID 替换为目标 Catalog ID，运行 migration/seed/sync。
4. 在目标 Windows/Linux/macOS 终端各执行 `nova config validate`、`nova doctor --deep` 和一次安装/回滚冒烟。

## 当前宿主机提示

Compose 的四服务健康、匿名同步与 Admin 验收完成后，Docker Desktop 的 BuildKit 存储在最终重建镜像层时变为只读；随后普通服务重启因当前会话没有 Windows 服务管理权限而未恢复。该事件不影响源码、Node 测试、构建或 npm 制品，但本机再次执行 Compose 前需要以有权限的账户重启 Docker Desktop。不要删除 PostgreSQL volume；已完成的 Compose 验收数据位于该卷中。
