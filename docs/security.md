# 安全边界

Secret Store 在 Windows 使用 DPAPI CurrentUser；其他平台使用 AES-256-GCM + scrypt 主密码文件。CLI 只枚举键名。Runtime 配置保存 `${ENV_NAME}`，明文仅进入目标子进程环境，不进入 Desired、Lock、Revision、日志或 Hub。

下载仅允许 Deployment 白名单主机，重定向重新校验；归档限制压缩大小、展开大小、文件数并防路径穿越。生命周期脚本默认关闭。命令始终以 executable + args 数组执行，不拼接 shell 字符串。

高风险能力达到 `requireApprovalAt` 时必须显式 `--yes`；未审核来源默认拒绝。本地目录还必须 `--allow-untrusted`。Doctor Upstream 只执行声明为 safe 的白名单 HTTP GET。

Hub 当前默认开放访问，读写接口仍记录 before/after 审计，适用于有独立网络边界的可信内网。需要应用层认证时设置 `NOVA_HUB_AUTH_ENABLED=true`，所有接口随即要求 Bearer Token。生产建议接入 OIDC/网关、短期 Token、TLS 与最小权限数据库账号；开发 Token 不得复用。开放模式不等于公网安全模式，禁止直接暴露到非可信网络。
