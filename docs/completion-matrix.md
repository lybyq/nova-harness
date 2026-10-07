# Nova Harness 1.0 完成交付矩阵

本矩阵以原始实施清单为完成口径。状态为“完成”表示已经具备实现、中文 JSDoc、确定性测试和可运行验收；接入另一套内网只需要替换 Deployment Profile 与 Secret，不修改业务代码。

| 工作流                 | 状态 | 已交付能力与验收                                                                                             |
| ---------------------- | ---- | ------------------------------------------------------------------------------------------------------------ |
| Secret / Configuration | 完成 | DPAPI、AES-256-GCM 回退、隐藏输入、导入、连通性测试、全链路脱敏                                              |
| Project Profile        | 完成 | init/status/apply/unlink、分层合并、项目 Lock 与幂等执行                                                     |
| Capability 管理        | 完成 | add/remove/enable/disable/update、依赖保护、dry-run 与风险确认                                               |
| Hub 管理               | 完成 | list/add/remove/use/login/logout/status/sync；开放 Hub 支持无 Token                                          |
| Role 管理              | 完成 | current/use/diff/create/clone/edit/validate/publish、继承与冲突检测                                          |
| Revision / Rollback    | 完成 | before/after 快照、show、默认/指定回滚、Journal 与失败恢复                                                   |
| Runtime                | 完成 | list/detect/use/status/inspect/export，MCP/Plugin/Skill/Agent 完整编译                                       |
| Doctor                 | 完成 | 七层检查、deep、fix、单能力检查、MCP 协议检查                                                                |
| 运维命令               | 完成 | logs/audit/export/import/cache/prune/completion/exec                                                         |
| Hub Admin              | 完成 | Registry Dashboard、全局搜索、Catalog、Source、Role、Compatibility、Manifest、Audit；桌面/移动端可视验收     |
| 数据与来源             | 完成 | Prisma migration/seed、PostgreSQL、GitLab/npm 真实适配器、确定性 Mock                                        |
| 发布                   | 完成 | 9 个 `1.0.0` npm 包、workspace 依赖改写、release gate 与 `.tgz` 制品                                         |
| 验收                   | 完成 | Windows 主机、Linux 容器、37 项确定性测试、核心覆盖率 94.75%/90.69%、2 项公网真源冒烟、Compose 同步 4 项能力 |

## 中文 JSDoc 规则

1. 所有导出的类、接口、函数使用中文 JSDoc。
2. 有安全边界、事务、回滚或跨平台差异的内部函数说明失败行为与保护边界。
3. 注释说明“为什么”和约束，不重复代码表面语义。
4. Secret、文件写入和子进程 API 明确泄露与破坏性边界。

## 不属于代码缺口的接入项

- 目标内网的真实域名、Group、Scope、企业 CA、代理和 Token 必须由部署方填写。
- macOS 未在本机执行实机安装；路径、权限与子进程差异由跨平台实现及确定性测试覆盖，上线前仍应按验收手册在目标终端做一次冒烟。
- 默认开放访问适用于可信内网；暴露到非可信网络前必须启用应用鉴权或 OIDC 网关。
