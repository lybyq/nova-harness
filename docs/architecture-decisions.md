# 架构决策

## 1. 产品边界

Nova Harness 是一个由 CLI、Core、Hub API、Hub Admin 和 Runtime Adapter 构成的平台。CLI 是首个客户端，不承担源站全量扫描和业务元数据治理。

## 2. 跨内网部署

同一套代码通过版本化的 Deployment Profile 切换内网。Profile 管理 Hub、GitLab、npm、网络、信任和 Runtime 策略；Secret 只保存引用，不进入配置文件。

品牌名、CLI 命令和协议名称保持稳定。GitLab Group、npm Scope、Registry 类型、CA、代理和下载白名单均可配置。

## 3. 能力和角色

MCP、Skill、Plugin、Agent、Hook、Policy、Pack 统一为 Capability。Role 只通过以下四类 Requirement 引用 Capability：

- required：不可被低层 Profile 移除；
- recommended：默认启用，可被用户显式排除；
- optional：仅在显式选择时启用；
- denied：企业或角色层禁止。

Role 不再重复保存独立的 skills/plugins 列表。

## 4. 状态作用域

所有 Desired State、Actual State、Lock、Revision、Ownership 都带 Deployment、Runtime、Scope 和 Project Identity。项目 Lock 与用户 Lock 分离，避免跨项目互相覆盖。

## 5. Apply 与恢复

Apply 是带 Journal 的补偿事务，不宣称跨文件系统、Credential Manager、包管理器和 Runtime CLI 的 ACID。每一步包含幂等键、前置校验、补偿操作和恢复状态；进程崩溃后可继续或回滚。

## 6. 下载和认证

1.0 默认采用 direct 模式：CLI 直接访问 GitLab/npm，并通过本机 Secret Store 获取源站凭据。Hub 只保存系统同步凭据的 Secret 引用。

若部署要求终端用户只有 Hub Token，必须启用后续的 artifact-cache/signed-download 模式，不能假设 direct 模式满足该网络边界。

## 7. 元数据来源

发现值、管理员覆盖值和最终生效值分层保存。同步不会覆盖管理员修正。只有一次完整同步成功后，才允许把本轮缺失资源标记为软删除。

## 8. npm 发现

包元数据接口相对统一，包枚举不是统一协议。生产环境优先显式声明 adapter：npm-compatible、nexus、cnpm 或 static-index。auto 仅用于引导和开发环境。

## 9. Runtime 权限

Harness 使用跨 Runtime 的抽象权限；Adapter 编译为目标 Runtime 规则，并逐条报告 compiled、degraded、unsupported。无法表达的规则不能静默放行。

## 10. 测试分层

- 单元/契约测试：纯本地、可重复；
- Mock 集成测试：GitLab API、npm Registry、Claude Runtime；
- 公网冒烟：独立命令、非默认 CI；
- 内网验收：真实 Token、企业 CA、代理、嵌套 Group 和至少一种真实能力。
