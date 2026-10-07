# CLI 使用手册

全局选项：`--config`、`--hub`、`--json`、`--quiet`、`--no-color`、`--non-interactive`、`--lang`、`--verbose`、`--debug`、`--yes`。CI 应同时使用 `--non-interactive --json --no-color`。

开放 Hub 首次使用：

```bash
nova hub add default https://harness.example.corp/api/v1
nova hub use default
nova init --role frontend --runtime claude-code --mode isolated --yes
nova doctor --deep --json
```

目标内网启用认证后，改用 `nova hub add default <url> --auth-ref NOVA/HUB_TOKEN`，再执行 `nova hub login`。未声明 `authRef` 时 CLI 不会虚构或索要 Token。

常用闭环：`search/info/versions/dependencies/compatibility` 发现；`add/remove/enable/disable/update` 自动生成 Plan 并 Apply，追加 `--dry-run` 仅预览；`history show/rollback` 恢复；`cache verify/prune` 校验 Store；`runtime inspect/export` 排障；`launch/exec` 启动。

本地能力必须显式执行 `nova add ./path --type skill|plugin|mcp --allow-untrusted --yes`。目录会复制进不可变 Store，后续离线运行不依赖原路径。`npm:` 和 `git:` 定位符仍需先由可信 Hub 同步。

退出码：`0` 成功，`2` 配置，`3` 网络，`4` 鉴权/权限，`5` 兼容性，`6` Plan 冲突，`9` Doctor 非健康；其他失败为 `1`。
