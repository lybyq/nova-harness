# 运维手册

每日关注 `/health`、最近 SyncRun、失败 SyncItem、待审核能力和 Admin Audit。同步使用 PostgreSQL advisory lock 防重入，整轮成功后才软删除源站消失条目。

发布顺序：备份数据库；部署 Hub API；执行 migration；部署 Admin；同步一套 canary Source；发布 CLI。回滚应用版本不会回滚数据库 migration，migration 必须保持向后兼容。

容量管理：`nova cache status` 查看本地占用，`cache verify` 重算不可变 Store 摘要，`prune` 只删除所有 Actual State 都未引用的版本。Revision 是回滚依据，不应与 Cache 一起清理。

告警建议：Hub 5xx、同步连续失败、401/403 激增、数据库连接耗尽、Catalog 异常软删除量和 Audit 高风险操作。
