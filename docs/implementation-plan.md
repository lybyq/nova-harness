# Nova Harness 1.0 实施计划（已完成）

## 最终交付快照（2026-08-08）

- [x] 阶段 1：工程、契约、Profile、Core 与可移植部署示例。
- [x] 阶段 2：GitLab/npm、Prisma、Sync/Catalog/Role/Resolve/Marketplace/Manifest API。
- [x] 阶段 3：Store、完整性、安全解压、Journal/Revision、Apply/Rollback、Claude Code Adapter、Secret 与日志脱敏。
- [x] 阶段 4：完整 CLI 命令面、项目覆盖、Secret Store、Doctor、运维与补全。
- [x] 阶段 5：开放访问 Hub Admin、Registry Dashboard、全局搜索、Catalog、Source、Role、Compatibility、Manifest、Audit。
- [x] 阶段 6：Windows/Linux 容器、PostgreSQL Compose、确定性 E2E、公网真源、浏览器响应式与 npm 发布包验收。

## 阶段 1：架构与契约

- Monorepo、TypeScript、ESLint、Prettier、Vitest、构建和发布门禁；
- Deployment Profile、Capability、Role、State、Plan、Revision 契约；
- Profile 合并、依赖解析、Semver、冲突检测和 State Diff；
- 公网、Mock 与目标内网部署示例。

## 阶段 2：来源和 Hub

- GitLab Group/Subgroup 分页发现与 npm-compatible/static-index 发现；
- PostgreSQL/Prisma migration、seed、同步、Catalog、Resolve 与治理 API；
- Bearer 鉴权开关：默认开放，配置后恢复认证；
- 公网只读冒烟与确定性 Mock 下载/协议链路。

## 阶段 3：Installer 与 Runtime

- 版本化 Store、完整性校验、主机白名单和安全解压；
- Ownership、Journal、Revision、Apply、Rollback 与失败恢复；
- Windows DPAPI / 跨平台 AES-256-GCM Secret Store；
- Claude Code Integrated/Isolated、MCP、Skill、Plugin、Agent 与用户配置保留。

## 阶段 4：CLI

- Hub、Catalog、Capability、Role、Project、Plan/Apply/Diff；
- Doctor、History/Rollback、Secret、Runtime、Launch/Exec；
- Logs/Audit、Export/Import、Cache/Prune、Completion；
- `--json`、非交互、退出码、脱敏和可选 Hub 凭据。

## 阶段 5：Hub Admin

- 深墨绿基础设施 Registry 视觉系统和开放访问标识；
- Dashboard 全局检索、指标、推荐能力、同步动态和 Quick Start；
- Catalog URL 同步筛选、治理状态、丰富列表和详情抽屉；
- Source、Role、Compatibility、Manifest、Audit 管理；
- 1440 桌面与 390×844 移动端浏览器验收，控制台零错误。

## 阶段 6：验收与发布

- 37 项确定性单元/集成/E2E 测试，Harness Core 行覆盖 94.75%、分支覆盖 90.69%；
- 2 项公网 GitLab/npm 真源冒烟；
- Compose 中 PostgreSQL migration/seed、Mock GitLab/npm、匿名 Hub 同步与 Admin；
- 9 个公共包 `1.0.0` 实际打包，CLI 包内 workspace 依赖均改写为固定版本；
- 运维、部署、安全、排障、内网迁移与验收文档。
