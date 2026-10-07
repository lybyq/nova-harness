# 故障排查

先运行 `nova doctor --deep --json`。七层分别定位 Hub/源站、Store、Secret/配置、Claude 进程、MCP initialize/tools-list、上游只读探针和 Runtime 模式。

- 401：重新 `hub login` 或核对 authRef；403：Token 缺 `read_api/read_repository`。
- Store checksum mismatch：不要手改 Store，执行 `cache verify` 后重新 update/apply。
- Plan stale：Desired 或 Actual 已变化，重新 `nova plan`。
- 配置冲突：检查同名 Skill/Plugin 是否是用户目录；Harness 不会覆盖无 ownership 标记的目录。
- Apply 失败：查看 `history show <revision>`；自动回滚失败时停止写操作，保留 Revision 后人工恢复。
- Docker 数据卷只读：先备份，再由运维检查 Docker Desktop/磁盘；不要在未知卷上直接删除。

日志输出经过 Redactor。提交诊断材料前仍应检查企业域名、项目路径和业务信息。
