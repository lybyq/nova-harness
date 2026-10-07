# Hub 部署

## 本地确定性环境

```bash
docker compose up -d --build
curl http://localhost:3200/api/v1/health
```

服务端口：Hub API `3200`、Hub Admin `3210`、Mock GitLab/npm `3400`、PostgreSQL `5432`。本地 Profile 默认开放访问，Hub Admin 与 CLI 都不需要登录或 Token。

Compose 启动时自动执行 Prisma migration 与七种内置角色 seed。生产部署应单独运行 `pnpm prisma:migrate`，再以只读文件挂载 Deployment Profile。若目标内网需要鉴权，设置 `NOVA_HUB_AUTH_ENABLED=true`，并由密钥平台注入 `NOVA_HUB_DEV_TOKEN` 或在网关层接入 OIDC；开放模式必须保持 `NOVA_HUB_AUTH_ENABLED=false`。

## 内网切换

复制 `manifests/deployments/internal.example.yaml`，替换 Hub/GitLab/npm 地址、Group、Scope、企业 CA、代理和下载白名单。`authRef` 是可选项：开放 Hub 删除 `hub.authRef`；需要认证时保留引用，并通过环境或 CLI Secret Store 提供值，禁止把 Secret 写入 YAML。更新后先执行 `nova config validate`、`nova hub status`、`nova hub sync`。

备份 PostgreSQL 与 Deployment Profile。Catalog 可重新同步，但 Admin overrides、Role 草稿和 Audit 依赖数据库备份。升级前执行数据库备份、migration dry-run 和 Mock E2E。
