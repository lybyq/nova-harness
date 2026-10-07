# 架构说明

Nova Harness 把来源、治理、解析、安装和运行时编译分成五个稳定边界：GitLab/npm 是二进制源站；Hub 保存 Catalog、角色、兼容性和审计元数据；Core 只处理 Profile、依赖和 Plan；Installer 维护不可变 Store、Revision 与 Lock；Runtime Adapter 把 Desired State 编译成 Claude Code 配置。

Deployment Profile 是跨内网迁移边界。域名、Group、Scope、Token 引用、代理、CA、信任阈值和 Runtime 均来自 YAML/环境变量。Hub 不代理二进制，也不保存用户业务 Token。

本地状态采用 Desired/Actual/Plan/Apply：任何命令先修改 Desired 并生成可预览 Plan；Apply 在全局进程锁内创建 before/after Revision，逐项写 Journal，失败逆序回滚。`ownership.json` 与 JSON sidecar 只声明 Harness 拥有的字段和目录，用户原配置不会被整体覆盖。

Claude Code 支持 Integrated 与 Isolated。Integrated 合并用户/项目配置；Isolated 设置 `CLAUDE_CONFIG_DIR`，不触碰既有 Claude 配置。MCP Secret 以 `${ENV_NAME}` 引用写入配置，仅在 `launch/exec/doctor --deep` 子进程环境中注入。
