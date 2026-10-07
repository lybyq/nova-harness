# Capability Manifest

GitLab 仓库根目录可放置 `nova.manifest.yaml`。最少声明 `metadata.id/displayName/description`；缺失或入口无效时 Hub 仍保留条目并标记 `needs-review`。

Skill 必须包含带 `name`、`description` frontmatter 的 `SKILL.md`；Plugin 必须包含 `.claude-plugin/plugin.json` 且 `name` 非空；npm MCP 的 `package.json` 必须提供 `bin` 和配置字段（默认 `novaHarness`）。版本可声明 dependencies、conflicts、secrets、configuration、healthChecks 和 `runtimeBindings.claude-code`。

Git Tag 使用 SemVer；没有 Tag 时固定到默认分支 Commit SHA 并生成 `0.0.0-<sha>`。安装器校验 npm SRI、可选 SHA-256、Manifest checksum、解压路径、文件数与展开大小。
