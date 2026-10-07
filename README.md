# Nova Harness

Nova Harness 是面向内网 Agent 能力的发现、治理、角色组合、安装、Runtime 配置与诊断入口。仓库采用可移植的 Deployment Profile：切换另一套内网时，不修改业务代码，只替换 Hub、GitLab、npm、网络、信任和 Runtime 配置。

## 已落地的可运行闭环

- GitLab Group 与 npm Registry 真实适配器，支持分页、嵌套 Group、Manifest 缺失降级、重试、Token 引用和静态 npm 索引。
- NestJS Hub API：Catalog、Role、Resolve、Sync、Manifest 校验、Claude Marketplace、Swagger，以及可配置的 Bearer 认证（默认开放访问）。
- PostgreSQL/Prisma 模型、首个迁移和可编辑的 7 类角色 Seed。
- Vue 3 + Element Plus 管理端：开放访问的 Registry 风格 Dashboard、全局搜索、Catalog/版本/兼容性、来源同步、Role、Manifest 与审计治理，并完成桌面/移动端响应式适配。
- CLI：Hub、Catalog、能力、角色、项目、Desired/Actual/Plan/Apply、七层 Doctor、Secret、Runtime、日志/审计、导入导出、缓存、补全和 Revision/回滚完整闭环。
- Core：角色继承/覆盖、依赖拓扑、Semver 解析、冲突检测、Desired/Actual/Plan。
- Installer：固定版本制品下载、主机白名单、SRI/SHA-256、归档路径保护、npm 生产依赖、原子 Store、进程锁、Revision Journal 和失败回滚。
- Claude Code Adapter：Integrated/Isolated、MCP、Skill、Plugin Marketplace、Agent、Permission、CLAUDE.md 字段级合并，保留用户非托管配置。
- Windows DPAPI 与 AES-256-GCM Secret Store、无明文 Lock/Revision、Store 内容摘要、本地目录显式信任。
- Compose Mock GitLab/npm/MCP 环境，可在没有内网 Token 时跑真实下载和协议 E2E。

## 环境

- Node.js >= 20.18
- pnpm 11
- PostgreSQL 17（本机可用 Docker Compose 启动）

```powershell
cd E:\ai\nova-harness
pnpm install
Copy-Item .env.example .env
docker compose up -d --build
```

开发运行：

```powershell
$env:DATABASE_URL='postgresql://nova:nova@localhost:5432/nova_harness?schema=public'
$env:NOVA_DEPLOYMENT_CONFIG='E:\ai\nova-harness\manifests\deployments\mock-host.yaml'
$env:NOVA_HUB_AUTH_ENABLED='false'
pnpm --filter @nova-cbb/hub-api dev
pnpm --filter @nova-cbb/hub-admin dev
```

Hub API 默认在 `http://localhost:3200/api/v1`，Swagger 在 `http://localhost:3200/api/docs`；管理端默认在 `http://localhost:3210`。默认不要求登录或 Token；需要认证时设置 `NOVA_HUB_AUTH_ENABLED=true` 并通过 `NOVA_HUB_DEV_TOKEN`（或生产网关/OIDC）提供凭据。

## CLI 示例

```powershell
$config='E:\ai\nova-harness\manifests\deployments\mock-host.yaml'
node apps/cli/dist/main.js --config $config config validate
node apps/cli/dist/main.js --config $config doctor
node apps/cli/dist/main.js --config $config init --role frontend --mode isolated --scope user --yes
node apps/cli/dist/main.js --config $config status
node apps/cli/dist/main.js --config $config role list
node apps/cli/dist/main.js --config $config add mock-mcp --yes
node apps/cli/dist/main.js --config $config runtime doctor
```

所有命令支持 `--json`、`--quiet`、`--no-color` 和 `--non-interactive`。开放 Hub 不配置 `hub.authRef` 即可匿名访问；启用鉴权后再配置 Secret 引用，例如 `authRef: NOVA_HUB_TOKEN` 并设置 `$env:NOVA_HUB_TOKEN='...'`。源站凭据同样只保存引用，值不会写入 YAML、状态或日志。

## 迁移到另一套内网

复制 [internal.example.yaml](manifests/deployments/internal.example.yaml)，只修改：

1. `metadata.id` 与 Hub URL；开放 Hub 删除 `hub.authRef`，鉴权 Hub 保留并替换它。
2. GitLab `baseUrl/rootGroup/skillGroupPath/pluginGroupPath/authRef`。
3. npm `registry/adapter/scopes/packagePatterns/authRef`。
4. 企业 CA、代理、`allowedHosts` 和重定向白名单。
5. Runtime 模式与风险信任策略。
6. 把角色 Seed 中 `mappingStatus: pending` 的能力映射成目标 Catalog 的真实 ID，再执行 `pnpm prisma:seed`。

代码不依赖固定 Group、Scope、Registry、域名或品牌路径。生产环境建议显式使用 `static-index`、`nexus`、`cnpm` 或 `npm-compatible`，不要依赖自动猜测私有源能力。

## 质量检查

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:smoke:public
pnpm release:check
```

公网冒烟是非确定性检查，不应放进强制 CI；内网上线前仍需用真实 Token、企业 CA/代理、嵌套 Group 和至少一个真实 Skill/Plugin/MCP 做验收。

详细文档：

- [架构](docs/architecture.md) 与 [架构决策](docs/architecture-decisions.md)
- [Hub 部署](docs/hub-deployment.md) 与 [运维](docs/operations.md)
- [CLI 使用](docs/cli-usage.md) 与 [故障排查](docs/troubleshooting.md)
- [Capability Manifest](docs/capability-manifest.md)、[Role 编写](docs/role-authoring.md)、[安全](docs/security.md)
- [1.0 验收报告](docs/acceptance-report.md) 与 [完成矩阵](docs/completion-matrix.md)
- [完整仓库目录树](docs/repository-tree.md)
