# Nova Desktop × DeepSeek Harness 详细实施方案

> 文档状态：实施基线  
> 编写日期：2026-09-19  
> 上游选型复核：2026-10-05  
> Nova 仓库：`E:\ai\nova-harness`  
> DeepSeek Harness 源码：`E:\ai\deepseek-harness`  
> 当前本地 DeepSeek Harness 基线：`0.1.6-alpha.2` / `ddefc45fbc7f8e46dd73185e68295696d1297887`  
> Nova 目标候选基线：`0.2.0-rc.2` / `639ed015397290b3745d163aafe02ffee4aa3f84`，通过本章升级门禁后采用

## 1. 目标与范围

本方案只交付一个面向最终用户的桌面产品：**Nova Desktop**。

最终用户只接触四个概念：

1. 项目 Workspace
2. 角色 Role
3. AI Hub
4. 聊天 / 任务

用户主路径：

```text
打开 Nova Desktop
→ 登录或进入离线模式
→ 选择项目目录
→ 选择角色，例如“前端工程师”
→ Nova 解析并加载角色对应的 MCP / Skill / Extension / 权限
→ 创建绑定该角色版本的新会话
→ 开始聊天或执行任务
```

本方案中的“只要桌面端”具体定义为：

- 不交付单独的 Nova Web 用户端。
- 不把现有 `hub-admin` 作为第二个用户入口。
- 不要求普通用户安装或使用 Nova CLI。
- Electron 内不嵌入 NestJS、Prisma 和 PostgreSQL。
- 企业部署仍可运行 Nova Hub API，作为 Desktop 背后的能力目录、角色、策略和制品服务。
- 无 Hub 环境通过签名 Catalog Snapshot 和本地缓存提供离线能力。

企业级 AI Hub、统一权限、组织角色、制品审核和集中审计必须有服务端控制面；“只交付桌面端”不等于把所有企业服务强行塞进 Electron。

## 2. 已确认的源码事实

### 2.1 DeepSeek Harness 基线

本地 `E:\ai\deepseek-harness` 当前版本为 `0.1.6-alpha.2`，提交为：

```text
ddefc45fbc7f8e46dd73185e68295696d1297887
```

该源码已经具备：

- Electron Desktop 壳。
- 完整 Web UI。
- Agent Loop、Session、Tools 和持久化。
- Workspace 管理。
- DeepSeek LLM Adapter。
- Agent Preset。
- MCP Client。
- Skill Registry 和 Skill Provider。
- Sandbox、Approval 和 Permission Preset。
- Plugin Manager、Profile 和 Bundle。
- Desktop 自动更新、签名、恢复和单实例控制。

关键入口：

```text
E:\ai\deepseek-harness\apps\desktop
E:\ai\deepseek-harness\apps\desktop-host
E:\ai\deepseek-harness\packages\bundle\base
E:\ai\deepseek-harness\packages\bundle\web-app
E:\ai\deepseek-harness\packages\preset\agent-presets
E:\ai\deepseek-harness\packages\mcp\mcp-client
E:\ai\deepseek-harness\packages\skill
E:\ai\deepseek-harness\packages\interaction
E:\ai\deepseek-harness\packages\credentials
```

Desktop 当前使用：

```text
$DSH_HOME/profiles/desktop
```

其 Profile 默认组合为：

```text
@deepseek-ai/dsh-base
@deepseek-ai/dsh-web-app
```

Nova 应在这两个 Bundle 后增加自己的 Bundle，而不是修改 Agent Loop。

### 2.2 当前 Nova Harness 能力

`E:\ai\nova-harness` 已经拥有：

- Capability、RoleProfile、DeploymentProfile 契约。
- Role 继承、覆盖和 Capability 依赖解析。
- Desired / Actual / Plan / Apply。
- GitLab/npm 能力发现。
- Hub API 和 Catalog。
- Hub Admin。
- 制品完整性校验、Store、Revision 和回滚。
- Secret Store。
- Claude Code Runtime Adapter。

当前主要问题：

- Runtime 默认仍是 `claude-code`。
- Role Manifest 中的能力映射仍为空。
- 没有 Nova Desktop。
- Hub 认证主要是开发 Bearer Token。
- 没有面向 DSH Agent Preset 的编译器。
- 没有 DSH Skill Provider、Policy Enforcer 和 Credential Provider。

## 3. 总体技术决策

> **2026-10-05 选型修订：** 默认实施模式已调整为“官方 DSH 精确锁版 Runtime + Nova 自有 Desktop/Enterprise Layer”，详见第 26 节。以下涉及“完整企业 fork”的内容保留为 **Mode B 源码构建兜底方案**：仅当官方发布包或公开 SDK 无法提供必要扩展点时启用，并且 Patch 必须进入 Patch Registry。文中仍出现的 `0.1.6-alpha.2`/`ddefc45f...` 是当前本地源码检查快照或历史迁移基线，不是 Nova 1.0 的目标 Runtime Lock。

### 3.1 产品代码归属

两个现有仓库分别承担不同职责：

```text
E:\ai\deepseek-harness
└─ 官方 DSH 上游镜像与 Runtime 验证工作区
   ├─ 固定官方 Tag / Commit
   ├─ 生成和验证官方 Runtime Closure
   ├─ 执行上游兼容性门禁
   └─ 必要时承载范围最小的 Mode B Patch Series

E:\ai\nova-harness
└─ Nova 产品主仓库
   ├─ apps/nova-desktop
   ├─ Contracts / Desktop SDK
   ├─ Nova Bundle / Host Plugins / Client UI Plugins
   ├─ Role / Capability Resolver
   ├─ Hub API / Artifact / Trust
   ├─ Policy / Credential / Audit
   └─ 安装器、更新器和企业发布流水线
```

不允许两个仓库通过 `../../nova-harness` 这类相对路径形成运行时依赖。共享模块必须：

- 发布到企业 npm Registry；或
- 在 Nova Desktop 下游仓库中以正式 workspace package 存在。

第一阶段推荐把 Desktop 必需的轻量契约发布为：

```text
@nova-cbb/harness-contracts
@nova-cbb/harness-core
@nova-cbb/harness-shared
```

Hub 服务、Prisma、NestJS 和 Vue Admin 不进入 Desktop 生产依赖闭包。

### 3.2 上游维护策略

默认采用 Mode A，把官方 DSH 当作精确锁定的外部 Runtime：

```text
deepseek-ai/deepseek-harness tag + commit
  ↓ 官方 npm 包 / 内网镜像 / integrity lock
Nova Runtime Graph
  ↓ Bundle / Plugin / Provider / Preset / Desktop SDK
Nova Desktop
```

该模式下 `E:\ai\deepseek-harness` 不开发 Nova 产品功能，只用于源码核对、构建验证和升级比较。Nova 包发布到企业 npm Registry，再由 Nova Desktop Profile 组合。

仅当官方发布包或公开扩展点无法满足经过验证的必要需求时，启用 Mode B 受控源码分支。允许修改的上游区域限定为：

- `apps/desktop`：品牌、产品 ID、路径、更新源和打包。
- `apps/desktop-host`：挂载极少量必须由 Desktop Host 直接拥有的 Nova 服务。
- 新增 `packages/nova/*`：Nova 独有插件和 Bundle。
- 少量构建脚本：将 Nova 包加入 Desktop runtime closure。

禁止修改：

- `packages/core/agent-loop`
- Session 事件基础语义
- Tool 执行主流程
- DSH 原有 Profile 解析规则
- DSH 原生 MCP 协议实现

每一个 Mode B Patch 必须记录：适用的官方精确版本、原因、所有者、回归测试、上游替代能力和删除条件。能迁回公开 SDK/Plugin 边界后必须删除 Patch。

### 3.3 最终运行架构

```text
┌──────────────────────────────── Nova Desktop ────────────────────────────────┐
│ Electron Main                                                               │
│ ├─ 单实例、窗口、协议、更新、签名、恢复                                    │
│ ├─ Nova Home / Desktop Profile 所有权                                       │
│ └─ 启动 Desktop Host                                                        │
│                                                                             │
│ Desktop Host / Cordis                                                       │
│ ├─ @deepseek-ai/dsh-base                                                    │
│ ├─ @deepseek-ai/dsh-web-app                                                 │
│ └─ @nova-cbb/dsh-nova-desktop-bundle                                        │
│    ├─ Nova Hub Client                                                       │
│    ├─ Nova Role Service / Compiler                                          │
│    ├─ Nova Capability Provider                                              │
│    ├─ Nova Skill Provider                                                   │
│    ├─ Nova MCP Binding                                                      │
│    ├─ Nova Policy Enforcer                                                  │
│    ├─ Nova Credential Provider                                              │
│    ├─ Nova Audit Reporter                                                   │
│    └─ Nova UI Plugins                                                       │
│                                                                             │
│ Agent Scope                                                                 │
│ └─ Content-addressed Agent Preset                                            │
│    ├─ 角色 Persona / Instructions                                           │
│    ├─ Role Skills                                                           │
│    ├─ Role MCP Clients                                                      │
│    ├─ Role Tools                                                            │
│    └─ Role Policy Context                                                   │
└─────────────────────────────────────────────────────────────────────────────┘
                    │                            │
                    │ HTTPS / OIDC               │ DeepSeek API
                    ▼                            ▼
              Nova Hub API                企业 LLM Gateway
```

### 3.4 DeepSeek Harness 源码保留与裁剪策略（Mode B 兜底）

结论：**默认 Mode A 通过官方发布包和公开 SDK 组合 Nova Desktop；若验证后必须进入 Mode B 源码构建，则开发镜像保留完整上游源码，构建时只构建 Nova Desktop 所需目标，发布时只携带计算出的生产依赖闭包。任何模式下都不要手工删除 DeepSeek Harness 包。**

这里必须区分三个不同概念：

| 层次         | 是否保留全部源码 | 实际策略                                                                       |
| ------------ | ---------------- | ------------------------------------------------------------------------------ |
| Git 维护仓库 | 是               | 完整 fork `deepseek-ai/deepseek-harness`，保留上游提交历史，并定期合并固定版本 |
| CI 构建输入  | 否               | 只执行 Desktop、Desktop Host、Nova Bundle/UI 和它们的依赖构建及测试            |
| Nova 安装包  | 否               | 只发布编译产物、运行时依赖闭包、必要原生运行时和许可证，不发布源码、测试与文档 |

#### 3.4.1 为什么第一阶段必须保留完整 fork

DeepSeek Harness 当前不是“一个 Electron 壳加几个独立 npm 包”，它是带代码生成、Workspace 约束和发布闭包校验的 Monorepo。当前 Desktop 打包链为：

```text
apps/desktop
  → 构建整个 official package family
  → 打包 @deepseek-ai/dsh
  → 打包 @deepseek-ai/dsh-desktop-host
  → selectDesktopPackageClosure()
  → prepare:dsh
  → Electron Builder
```

其中有两个不能误删的根：

- `apps/cli` 的包名是 `@deepseek-ai/dsh`。虽然目录名叫 CLI，但它同时拥有 Profile 启动、Bundle 解析和 Desktop 运行依赖，是 Desktop 打包闭包根，不是可选命令行工具。
- `apps/desktop-host` 是 Electron 背后的 Node Host，负责 Web Server、工具运行、内置运行时和 Desktop 专有服务。

`@deepseek-ai/dsh` 当前直接依赖 `dsh-base`、`dsh-web-app`、MCP、Skill、Agent、Session、Sandbox、Client UI 等大量 Workspace 包。仓库还通过生成脚本、TypeScript project references、包约束和快照测试校验跨包关系。现在凭目录名删包，会造成以下问题：

- `build:official` 或 `release:pack` 失败；
- Cordis Catalog、Client Catalog 或 TypeScript references 失效；
- Desktop Package Closure 缺包；
- 上游升级时产生大量无意义冲突，无法判断 Nova 改动与裁剪改动的边界；
- 某个暂未启用的原生能力将来无法通过 Bundle 重新开启。

完整保留 fork **不等于** 最终安装包包含整个源码仓库。源码大小只影响 Git 和部分 CI，用户磁盘中的 Nova Desktop 由打包闭包决定。

#### 3.4.2 必须保留并纳入 Nova Desktop 构建的部分

下面是源码层面的核心集合。具体子包不要静态手抄白名单，而应由 Workspace 依赖图计算：

```text
apps/
├─ cli/                    # @deepseek-ai/dsh，Desktop 运行闭包根，必须保留
├─ desktop/                # Electron 主进程、打包、签名、更新，必须保留
└─ desktop-host/           # Desktop Node Host，必须保留

packages/
├─ bundle/base/            # Agent 核心 Profile
├─ bundle/web-app/         # Desktop 当前 React/Web UI 基础层
├─ client/**               # 会话、侧栏、设置、审批等 UI
├─ host/**                 # Web Server、静态前端、Desktop Host 能力
├─ core/**                 # Cordis/运行核心相关包
├─ agent/**                # Agent Loop 与 Agent 服务
├─ session/**              # 会话、持久化、投影
├─ mcp/**                  # MCP Client 与资源
├─ skill/**                # Skill 加载与工具
├─ sandbox/**              # 沙箱与策略
├─ credentials/**          # 本地凭据基础能力
├─ llm/**                  # DeepSeek/兼容模型 Provider
├─ preset/**               # Agent Preset
├─ tool、fs、shell、subprocess 等运行依赖
└─ nova/**                 # Nova 新增的 Bundle、Provider、UI 与策略包

vendor/**                  # 被生产闭包引用的 Cordis/Schemastery/Cosmokit
native/system/**           # Landlock/系统原生边界与平台包
scripts/**                 # 构建、Catalog 生成、发布和闭包校验脚本
```

上面的 `packages/**` 是能力域说明，不是人工删除清单。唯一可信的生产清单应来自包清单里的 `dependencies`、`peerDependencies`、`optionalDependencies` 和 Desktop Bundle 声明。

#### 3.4.3 可以不进入 Nova Desktop 安装包的内容

下列内容保留在开发 fork 中，但不应进入用户安装包：

- `website/` 和文档站点；
- `benchmarks/`；
- 单元测试、快照、fixture、覆盖率文件；
- TypeScript 源码、source map（生产环境默认关闭）；
- 仓库脚本、GitHub 配置、开发规范；
- 与目标平台无关的 Electron、原生二进制和可选 Provider；
- Nova 未启用的实验 Bundle 及其独占运行依赖；
- 开发依赖、Lint、Vitest、文档生成器。

当前 Electron Builder 已把 `buildPaths.dsh` 和 `buildPaths.runtime` 作为明确输入，`apps/desktop/scripts/prepare-package-set.ts` 也已经从 `@deepseek-ai/dsh` 与 `@deepseek-ai/dsh-desktop-host` 两个根递归选择 Workspace 依赖。Nova 应扩展这套机制，而不是另写一份手工复制脚本。

需要把 Nova 根加入闭包选择：

```ts
const ROOT_PACKAGES = [
  '@deepseek-ai/dsh',
  '@deepseek-ai/dsh-desktop-host',
  '@nova-cbb/dsh-desktop-bundle',
] as const;
```

同时要求所有 Nova 包正确声明生产依赖。最终安装包的内容由这三个根的传递依赖决定。

#### 3.4.4 推荐的仓库和分支方式

不要把 `E:\ai\deepseek-harness` 的源码整体复制进 `nova-harness`。推荐维持两个代码库：

```text
nova-harness                  # Nova Desktop、企业控制面、Bundle、SDK 和发布流水线
nova-dsh-upstream-mirror      # 官方源码镜像、版本验证；Mode B 时才含受控 Patch
```

上游镜像分支建议：

```text
upstream/main                 # DeepSeek 官方，只拉取不直接开发
mirror/official-tags          # 内网同步的官方 Tag
validate/dsh-*                # 一次性候选版本验证
patch/dsh-*                   # 仅 Mode B，小型兼容补丁
```

每次升级按以下顺序执行：

```text
拉取 upstream
→ 从官方 Tag 创建临时 validate 分支
→ 运行上游完整门禁
→ 运行 Nova Desktop 闭包、权限、Role、MCP 回归
→ 更新 upstream-lock.json
→ 同步官方 Tag；只有 Mode B Patch 才合并 patch 分支
```

建议新增 `upstream-lock.json`：

```json
{
  "repository": "https://github.com/deepseek-ai/deepseek-harness.git",
  "commit": "639ed015397290b3745d163aafe02ffee4aa3f84",
  "version": "0.2.0-rc.2",
  "npmIntegrity": "sha512-EAJ3gPNcVt/uv8X19PMm9NkVhWgT7xXNMk0UKCVm+IQ5rpSQOcsMUa0HWlnYYVybKMsccjcRB21vVVsaXQ6IdA==",
  "patchSeries": ["nova-branding", "nova-desktop-profile", "nova-package-closure"]
}
```

#### 3.4.5 何时可以真正删除上游源码目录

只有满足以下条件，才进入第二阶段的“物理裁剪”：

1. Nova Desktop 已完成至少一个稳定发布周期；
2. CI 能自动生成 Workspace 生产依赖闭包；
3. 全新机器可从空缓存完成构建、签名、安装和启动；
4. Role、MCP、Skill、审批、Sandbox、更新和回滚测试全部通过；
5. 已证明待删除目录既不在生产闭包，也不被代码生成、测试门禁或发布脚本引用；
6. 已评估该目录未来是否会作为 Hub 可选能力重新启用。

即使达到这些条件，也更推荐使用 CI sparse checkout、构建缓存和发布过滤来提速，而不是长期维护一个大规模删包的 fork。源码物理裁剪节省的主要是开发仓库体积，却会显著增加上游合并成本；通常收益小于代价。

#### 3.4.6 Nova 的最终执行决定

本项目按以下策略实施：

- **默认 Mode A：** 保留 `E:\ai\deepseek-harness` 作为只读上游镜像和兼容性验证工作区；Nova 产品代码进入 `nova-harness`，通过官方包、Bundle、Plugin、Provider、Preset 和公开 SDK 组合。
- **Mode B 兜底：** 只有公开扩展点不足且有验证证据时，才在受控源码分支修改 `apps/desktop`、`apps/desktop-host` 或构建闭包；不修改 Agent Loop。
- **CI：** Mode A 验证精确 npm Runtime Graph；Mode B 额外执行 `build:nova-desktop` 和上游 `check:all`。
- **发布：** 只打入自动计算的 Runtime Closure；源码、测试、网站和 Benchmarks 不随安装包发布。
- **社区能力：** 只按单组件经过 License、SBOM、权限、网络、遥测和兼容性审计后进入 Nova 内网制品库，不整体继承社区 Desktop。
- **后续：** 以构建证据决定是否做 sparse checkout，不以“看起来暂时没用”为理由删除上游包。

## 4. Desktop 目录与包设计

默认 Mode A 在 `E:\ai\nova-harness` 中新增对应的 Nova Desktop 和 DSH 扩展包，并通过企业 npm 制品组合进 Desktop Profile。下面沿用 `packages/nova/*` 展示包的逻辑边界；若进入 Mode B，才把同样的包临时接入 `E:\ai\deepseek-harness` Workspace 进行源码闭包构建。

```text
apps/nova-desktop/
packages/nova/
```

Nova 扩展包逻辑结构：

```text
packages/nova/
├─ desktop-bundle/
│  ├─ package.json
│  ├─ cordis.patch.yml
│  └─ src/index.ts
│
├─ hub-client/
│  ├─ src/index.ts
│  ├─ src/api.ts
│  ├─ src/cache.ts
│  └─ src/types.ts
│
├─ role-service/
│  ├─ src/index.ts
│  ├─ src/resolver.ts
│  ├─ src/compiler.ts
│  ├─ src/lock-store.ts
│  └─ src/preset-store.ts
│
├─ capability-provider/
│  ├─ src/index.ts
│  ├─ src/artifact-cache.ts
│  ├─ src/installer.ts
│  └─ src/inventory.ts
│
├─ skill-provider/
│  ├─ src/index.ts
│  ├─ src/provider.ts
│  └─ src/resource-loader.ts
│
├─ mcp-binding/
│  ├─ src/index.ts
│  ├─ src/connection.ts
│  └─ src/credential-env.ts
│
├─ policy/
│  ├─ src/index.ts
│  ├─ src/evaluator.ts
│  ├─ src/tool-identity.ts
│  └─ src/audit.ts
│
├─ credentials/
│  ├─ src/index.ts
│  ├─ src/local-store.ts
│  ├─ src/oidc.ts
│  └─ src/token-exchange.ts
│
├─ api/
│  ├─ src/index.ts
│  ├─ src/role-controller.ts
│  ├─ src/hub-controller.ts
│  └─ src/capability-controller.ts
│
├─ ui-brand/
├─ ui-role/
├─ ui-hub/
├─ ui-project/
└─ ui-policy/
```

命名统一使用现有组织 Scope：

```text
@nova-cbb/dsh-desktop-bundle
@nova-cbb/dsh-hub-client
@nova-cbb/dsh-role-service
@nova-cbb/dsh-capability-provider
@nova-cbb/dsh-skill-provider
@nova-cbb/dsh-mcp-binding
@nova-cbb/dsh-policy
@nova-cbb/dsh-credentials
@nova-cbb/dsh-api
@nova-cbb/dsh-client-ui-brand
@nova-cbb/dsh-client-ui-role
@nova-cbb/dsh-client-ui-hub
```

## 5. Nova Desktop Bundle

新增 `packages/nova/desktop-bundle/package.json`：

```json
{
  "name": "@nova-cbb/dsh-desktop-bundle",
  "version": "0.1.0",
  "type": "module",
  "main": "lib/index.js",
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    }
  }
}
```

Bundle 应位于 `dsh-web-app` 之后：

```text
@deepseek-ai/dsh-base
@deepseek-ai/dsh-web-app
@nova-cbb/dsh-desktop-bundle
```

Nova Bundle 的职责：

- 覆盖默认 Persona 和产品文案。
- 配置 Nova Role Preset 根目录。
- 挂载 Nova Host 服务。
- 挂载 Nova Client UI。
- 隐藏普通用户不应直接看到的 DSH Plugin Manager。
- 保留 Settings 中的诊断和插件只读信息。
- 挂载集中权限执行器。

`cordis.patch.yml` 骨架：

```yaml
- id: system-prompt
  config:
    personaPrefix: >-
      You are Nova, an enterprise AI agent powered by {{model}}.
    personaSuffix: Your working directory is {{cwd}}.

- id: ui-brand-official
  disabled: true

- id: ui-plugin-manager
  disabled: true

- id: agent-presets
  config:
    default: nova-general
    includeShippedRoot: false
    includeUserRoot: false
    roots:
      - path: !!js process.env.NOVA_ROLE_PRESET_ROOT
        trust: system

- insert:
    - id: nova-hub-client
      name: '@nova-cbb/dsh-hub-client'

    - id: nova-role-service
      name: '@nova-cbb/dsh-role-service'

    - id: nova-capability-provider
      name: '@nova-cbb/dsh-capability-provider'

    - id: nova-skill-provider
      name: '@nova-cbb/dsh-skill-provider'

    - id: nova-policy
      name: '@nova-cbb/dsh-policy'

    - id: nova-credentials
      name: '@nova-cbb/dsh-credentials'

    - id: nova-api
      name: '@nova-cbb/dsh-api'

    - id: nova-ui-brand
      name: '@nova-cbb/dsh-client-ui-brand'

    - id: nova-ui-project
      name: '@nova-cbb/dsh-client-ui-project'

    - id: nova-ui-role
      name: '@nova-cbb/dsh-client-ui-role'

    - id: nova-ui-hub
      name: '@nova-cbb/dsh-client-ui-hub'

    - id: nova-ui-policy
      name: '@nova-cbb/dsh-client-ui-policy'
```

注意：DSH Patch 对已存在 Row 的 `config` 是整体替换，不是字段级合并。每次覆盖上游 Row 时，必须复制该 Row 当前仍需保留的全部配置字段，并用测试锁定。

## 6. Electron 壳改造

### 6.1 修改范围

主要修改：

```text
E:\ai\deepseek-harness\apps\desktop\src\main.ts
E:\ai\deepseek-harness\apps\desktop\src\paths.ts
E:\ai\deepseek-harness\apps\desktop\src\project-manager.ts
E:\ai\deepseek-harness\apps\desktop\package.json
E:\ai\deepseek-harness\apps\desktop\resources\*
E:\ai\deepseek-harness\apps\desktop\scripts\package-target.ts
E:\ai\deepseek-harness\apps\desktop\README.md
```

### 6.2 品牌和应用身份

需要替换：

- Product Name：`Nova Desktop`
- Executable：`Nova`
- Windows App User Model ID
- macOS Bundle ID
- URL Protocol：`nova-app://`
- 图标、安装器图片、About 信息
- 更新源地址
- 发布签名证书配置

建议应用 ID：

```text
com.company.nova.desktop
```

不要继续使用 DeepSeek Harness 官方品牌资源。保留 MIT License 和第三方 Notice，并单独完成 DeepSeek 商标与品牌使用检查。

### 6.3 Nova Home

Nova 不应与用户独立安装的 DSH 共用 `~/.dsh`。

建议目录：

```text
Windows: %APPDATA%\Nova
macOS:   ~/Library/Application Support/Nova
开发:    E:\ai\deepseek-harness\apps\desktop\.desktop-build\development\nova-home
```

内部继续向 DSH Runtime 提供：

```text
DSH_HOME=<Nova Home>\harness
```

这样可以复用所有 DSH Home API，同时避免污染用户原有环境。

Nova 自有目录：

```text
<Nova Home>/
├─ harness/
│  ├─ profiles/desktop/
│  ├─ sessions/
│  ├─ settings/
│  └─ credentials/
├─ roles/
│  ├─ locks/
│  └─ presets/
├─ artifacts/
├─ catalog/
├─ audit-spool/
└─ logs/
```

### 6.4 Desktop Profile 初始化

修改 `apps/desktop/src/project-manager.ts`，不要再直接使用：

```ts
const WEB_PROFILE = PROFILE_TEMPLATES.web;
```

改为 Nova 自有常量：

```ts
const NOVA_DESKTOP_BUNDLES = [
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-web-app',
  '@nova-cbb/dsh-desktop-bundle',
] as const;
```

以下路径全部使用该列表：

- `createPluginProfile`
- `createRuntimeProjectMetadata`
- `createDevelopmentProjectMetadata`
- `disableAllPlugins` 的安全保留列表

恢复模式只能禁用第三方 Bundle，不能禁用 Nova 基础 Bundle。

### 6.5 打包闭包

Nova Bundle 及其依赖必须进入 Desktop runtime package set，不能依赖用户机器安装。

修改 Desktop runtime 准备脚本，使以下包进入 `desktop-runtime.json`：

```text
@nova-cbb/dsh-desktop-bundle
@nova-cbb/dsh-hub-client
@nova-cbb/dsh-role-service
@nova-cbb/dsh-capability-provider
@nova-cbb/dsh-skill-provider
@nova-cbb/dsh-mcp-binding
@nova-cbb/dsh-policy
@nova-cbb/dsh-credentials
@nova-cbb/dsh-api
@nova-cbb/dsh-client-ui-*
```

发布清单增加：

```json
{
  "novaVersion": "1.0.0",
  "dshVersion": "0.2.0-rc.2",
  "dshCommit": "639ed015397290b3745d163aafe02ffee4aa3f84",
  "contractVersion": "harness.nova/v2"
}
```

Desktop、DSH Runtime、Nova Bundle 必须作为同一个签名版本发布。

## 7. UI 实现

### 7.1 不复用 Vue Hub Admin UI

当前 `apps/hub-admin` 是 Vue 3 + Element Plus；DSH Web Client 是 React + Cordis Client Plugin。

不要：

- 在 Electron 内 iframe Hub Admin。
- 同时运行第二套前端路由。
- 把 Vue 构建产物硬塞进 DSH 页面。

应该复用 Hub Admin 的：

- API 字段定义。
- 搜索筛选逻辑。
- Catalog 展示信息。
- Role 编辑业务规则。

在 DSH Client Plugin 中重新实现 UI。

### 7.2 页面和导航

DSH 已提供 `sidebar.panellist` 与 root `main` keyed slot。Nova UI 直接按 Plugin Manager 的模式注册全局面板。

建议面板：

```text
conversation  → 聊天 / 任务，复用 DSH
nova-project  → 项目
nova-role     → 角色
nova-hub      → AI Hub
```

侧栏结构：

```text
Nova Logo
新建任务

项目 / 会话树

角色
AI Hub

设置
```

### 7.3 品牌插件

`@nova-cbb/dsh-client-ui-brand` 占用：

```text
sidebar.brand.mark
sidebar.brand.name
```

不要直接修改 `ui-sidebar` 的默认 Logo；通过 Slot 替换，减少上游合并冲突。

### 7.4 项目 Workspace

底层继续使用 DSH Workspace：

- Workspace ID 和规范路径由 DSH 管理。
- UI 文案统一显示“项目”。
- 新建任务时优先使用当前项目。
- Nova 在 Workspace ID 旁保存企业 Project Binding。

绑定数据：

```ts
interface NovaProjectBinding {
  workspaceId: string;
  tenantId?: string;
  remoteProjectId?: string;
  defaultRoleId?: string;
  classification?: 'public' | 'internal' | 'confidential' | 'restricted';
  labels: string[];
}
```

### 7.5 角色 Role

Role 页面展示：

- 系统角色。
- 团队角色。
- 我的角色。
- 当前项目默认角色。
- 角色包含的 Skill、MCP、工具和权限。
- 角色最近同步时间和离线状态。

新建 Session 前必须选定 Role。Session 产生第一条消息后，RoleLock 固定。

用户在已开始会话中点击切换角色时：

- 不修改当前 Session。
- 创建一个继承当前 Workspace 的新 Session。
- 可选将当前会话摘要注入新 Session，但必须形成新的持久 Session Event。

### 7.6 AI Hub

AI Hub 页面最小功能：

- 全文搜索。
- 类型筛选：MCP、Skill、Extension、Role。
- 标签、维护团队、风险等级筛选。
- 兼容性状态。
- 已添加/未添加状态。
- 权限需求和凭据需求。
- 添加到当前自定义角色。
- 从角色移除。
- 安装进度和错误恢复。

普通用户不能直接操作 DSH Profile Plugin Manager。AI Hub 必须走 Nova Capability Plan，显示权限变化后再 Apply。

### 7.7 用户从哪里安装和配置能力

普通用户只有一个能力管理入口：**AI Hub**。不再单独暴露“插件管理器”“MCP 配置文件”或“DSH Profile”。

推荐信息架构：

```text
AI Hub
├─ 能力市场
│  ├─ 全部
│  ├─ MCP
│  ├─ Skill
│  ├─ Extension
│  └─ Role
├─ 已安装
│  ├─ 可用
│  ├─ 需要配置
│  ├─ 需要授权
│  └─ 异常
└─ 我的角色
```

能力详情页统一包含：

```text
概览 | 配置与账号 | 权限 | 运行状态 | 版本
```

用户首次安装：

```text
AI Hub
→ 搜索“Jira”
→ 打开 Jira MCP
→ 点击“安装”
→ Nova 自动完成下载、校验、DSH 注册、授权和健康检查
→ 按钮变为“已安装”，状态显示“可用”
```

详情页顶部显示安装目标：

```text
安装到：当前项目 / 前端工程师角色
作用范围：我的账号
```

默认值来自当前 Workspace 和当前 Role，普通用户无需选择。高级用户才展开切换 Role 和 Scope。安装成功后自动更新目标 Role 的用户覆盖层并生成新 RoleLock，不要求用户再去角色页面点一次“添加”。

后续修改配置：

```text
AI Hub
→ 已安装
→ Jira MCP
→ 配置与账号
→ 修改 Endpoint、项目范围或账号
→ 测试并保存
```

项目级配置仍从同一个页面完成：

```text
AI Hub → 已安装 → Jira MCP → 配置与账号
作用范围：当前用户 / 当前项目 / 企业默认
```

项目页和聊天页只提供跳转入口：

- 项目页的“项目能力”跳到 `AI Hub / 已安装`，并自动筛选当前项目；
- 聊天中能力不可用时显示“Jira 需要授权”，点击后直接打开对应能力的“配置与账号”；
- Role 缺少 Binding 时，角色选择页直接打开该能力配置抽屉，完成后回到原流程。

不允许要求普通用户手工编辑以下内容：

- `agent.cordis.yml`；
- DSH Profile `package.json`；
- MCP JSON/YAML；
- 环境变量文件；
- Secret Reference；
- Plugin Bundle 列表。

这些内容全部由 Nova Desktop 根据 Hub Manifest 自动生成和维护。

#### 一键可用的产品定义

内部能力默认由管理员提供 Endpoint、网络策略、推荐版本和组织级默认配置，并优先接入 Nova OIDC/OAuth OBO。满足这些条件时，用户只需点击一次“安装”，无需填写任何字段。

如果某个能力必须使用个人 PAT、账号密码或用户专属项目参数，点击“安装”后在同一流程内打开配置抽屉：

```text
点击安装
→ 填写或完成企业授权
→ 自动测试
→ 自动启用
→ 显示“已安装 · 可用”
```

这不算“安装后再去配置”。安装流程只有在能力达到 `ready` 后才算完成。用户取消输入时显示“未完成配置”，不能显示“已安装”。

按钮文案按能力情况自动选择：

| 条件                | 主按钮     | 用户动作                           |
| ------------------- | ---------- | ---------------------------------- |
| 无配置、无凭据      | 安装       | 一次点击直接可用                   |
| 企业 SSO/OBO        | 安装并授权 | 一次点击后完成浏览器授权，自动可用 |
| 需要个人 Token/参数 | 配置并安装 | 同一抽屉填写、测试、启用           |
| 已可用              | 已安装     | 可进入“配置与账号”修改             |
| 配置或授权失效      | 修复配置   | 直接打开失败字段和诊断结果         |

面向普通用户的“已安装”必须等价于“当前选择的作用域内已经可用”，不能只代表 Artifact 已经下载到磁盘。

对于尚未开始的任务，安装完成后直接可用。对于已经产生消息的 Session，不能静默修改其 RoleLock；成功页提供“使用该能力新建任务”，自动继承当前 Workspace、Role 和可选会话摘要。这样不会破坏 DeepSeek Harness 的 Session/Agent Scope 不变量。

## 8. Role 到 Agent Preset 的编译

### 8.1 RoleLock

Hub 的 RoleProfile 是可变模板；Desktop 运行的是不可变 RoleLock。

```ts
interface NovaRoleLock {
  schemaVersion: 1;
  id: string;
  tenantId?: string;
  role: {
    id: string;
    version: string;
    displayName: string;
  };
  capabilities: Array<{
    id: string;
    type: 'mcp' | 'skill' | 'plugin' | 'agent' | 'hook' | 'policy' | 'pack';
    version: string;
    digest: string;
    runtimeBinding: string;
    configuration: Record<string, unknown>; // 仅允许非敏感、可共享配置
  }>;
  permissions: PermissionRule[];
  modelRoute: string;
  policyRevision: string;
  issuedAt: string;
  expiresAt?: string;
  checksum: string;
  signature?: string;
}
```

Preset ID：

```text
nova-<role-id>-<lock-checksum 前 12 位>
```

### 8.2 Preset 文件

每个编译结果：

```text
<Nova Home>/roles/presets/nova-frontend-72f0a31c2e6b/
├─ preset.yml
├─ agent.cordis.yml
├─ role-lock.json
└─ skills/
```

`preset.yml`：

```yaml
name: 前端工程师
description: Vue、TypeScript、前端工程化与企业研发工具
```

`agent.cordis.yml` 由标准模板和 RoleLock 生成：

```yaml
- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    prefix: >-
      你是 Nova 前端工程师，负责当前项目的前端开发、调试、测试和评审。
    suffix: 当前项目目录是 {{cwd}}。

- id: tool-pwsh
  name: '@deepseek-ai/dsh-tool-pwsh'
  disabled: !!js process.platform !== 'win32'

- id: tool-bash
  name: '@deepseek-ai/dsh-tool-bash'
  disabled: !!js process.platform === 'win32'

- id: tool-fs
  name: '@deepseek-ai/dsh-tool-fs'

- id: tool-fs-search
  name: '@deepseek-ai/dsh-tool-fs-search'

- id: nova-role-context
  name: '@nova-cbb/dsh-role-context'
  config:
    lockId: nova-frontend-72f0a31c2e6b

- id: nova-role-skills
  name: '@nova-cbb/dsh-role-skill-view'
  config:
    lockId: nova-frontend-72f0a31c2e6b

- id: nova-role-mcp
  name: '@nova-cbb/dsh-role-mcp-view'
  config:
    lockId: nova-frontend-72f0a31c2e6b
```

### 8.3 原子发布和回收

编译流程：

```text
校验 RoleLock
→ 校验签名和过期时间
→ 校验所有 Capability 本地可用
→ 写入 staging 目录
→ 重新读取并校验 YAML/JSON
→ 原子 rename 到最终目录
→ 通知 Agent Preset Roster 刷新
```

禁止覆盖已有 Preset。相同 checksum 必须生成相同内容。

旧 Preset 的清理条件：

- 没有存量 Session 引用。
- 不属于当前项目默认 Role。
- 不在回滚保留窗口内。
- 对应 Capability 制品也没有其他 Lock 引用。

## 9. Capability 映射规则

### 9.1 MCP

Nova Capability：

```yaml
id: jira-mcp
type: mcp
runtimeBindings:
  deepseek-harness:
    type: nova-mcp
    compatibility: '^0.1.6'
    configuration:
      transport: streamable-http
      serverName: jira
      endpoint:
        fromConfiguration: endpoint
      authentication:
        type: bearer
        credential: access-token
```

编译为 Agent Scope 内的 MCP Binding。

上述是 Runtime Binding 的简化表示，完整配置和 Credential Schema 见 9.5～9.19 节。

不要把 Token 明文写入 `agent.cordis.yml`。`@nova-cbb/dsh-mcp-binding` 在连接时通过 `ctx.credentials` 和本地 Capability Binding 解析引用，在内存中创建 MCP Client 配置。

远程 MCP 优先使用：

```text
OIDC 用户 Token
→ Nova Credential Broker / OAuth OBO
→ MCP Gateway 短期 Token
→ Jira / Wiki
```

stdio MCP 仅允许：

- 已审核 npm 包。
- 精确版本和 SHA-256。
- 固定 executable + args 数组。
- 明确环境变量白名单。
- 生命周期脚本显式审批。

### 9.2 Skill

`@nova-cbb/dsh-skill-provider` 注册到 DSH `ctx.skills`：

- `list()` 返回当前 RoleLock 可见的摘要。
- `get()` 从本地 digest 缓存加载完整内容。
- 缓存缺失时从 Hub 下载并校验。
- 离线时只使用已经签名且未过期的缓存。
- Skill 资源相对路径从本地不可变目录解析。

不需要把所有 Skill 复制进 DSH 用户目录。

### 9.3 Extension / Plugin

分两类：

1. Nova 系统插件：随 Desktop 发布，由 Nova Bundle 挂载。
2. 企业 Extension：由管理员审核后安装到 Desktop Profile。

普通用户添加到 Role 的 Extension 只是改变 Preset 可见性，不直接执行 `pnpm install`。缺少对应包时，先生成安装计划并完成制品安装，再发布新 RoleLock。

### 9.4 Pack

Pack 是 Nova Hub 的逻辑组合，不是 DSH Runtime 类型。

解析时展开成：

```text
Pack
→ Capability Requirements
→ 依赖解析
→ 版本锁定
→ RoleLock
```

Runtime 不应看到 Pack。

### 9.5 能力安装与配置的总体模型

当前仓库已经具备以下基础：

- `Capability.configuration` 可以声明简单配置项；
- `Capability.secrets` 可以声明所需 Secret；
- `runtimeBindings` 可以保存 Runtime 相关编译信息；
- Role、Project Override 和 Desired State 可以携带非敏感配置；
- `packages/secrets` 在 Windows 已经使用 DPAPI CurrentUser 保存 Secret；
- Plan/Apply 已经能报告 `requiredSecrets` 和 `requiredConfiguration`；
- Claude Runtime Adapter 已经采用 `${SECRET_REF}`，在启动边界才解析明文。

但是，现有实现还是“每个 Capability 一份全局配置”的模型，无法完整支持以下桌面产品场景：

- 同一个 Jira MCP 配置多个 Jira 实例或多个账号；
- 角色只声明“需要 Jira”，由不同用户选择自己的 Jira 连接；
- 根据 MCP 自己的 Schema 渲染不同的动态表单；
- 区分组织默认、项目配置、用户配置和会话临时配置；
- 表达 Bearer Token、Basic、OAuth、API Key、客户端证书等不同认证方式；
- 在不泄漏 Secret 的前提下测试连接、轮换凭据和重连；
- Skill/Plugin 有配置时复用同一套表单和 Secret 机制，无配置时保持一键安装。

因此需要把能力生命周期拆成四层：

```text
Catalog Definition
  Hub 中的能力定义、配置 Schema、凭据需求、运行时映射
          ↓
Artifact Installation
  某版本代码/资源在本机不可变 Store 中只安装一次
          ↓
Capability Binding
  用户或项目创建的能力实例，保存非敏感配置和 Secret Reference
          ↓
Role / Session Activation
  角色通过 Binding Slot 选择实例，Session 固定最终解析结果
```

必须坚持：

> 安装的是 Capability Artifact，配置的是 Capability Binding，角色引用的是 Binding Slot，运行时消费的是已经解析并锁定的 Binding。

这意味着：

- Skill/Plugin 没有声明配置和凭据时，安装完成即可启用；
- Skill/Plugin 声明配置时，使用和 MCP 完全相同的 Binding 表单；
- MCP 通常安装后进入 `configuration-required`，完成配置和连接测试后才变为 `ready`；
- 一个 Artifact 可以被多个 Binding 共享，切换账号不重复下载或安装代码；
- 删除一个 Binding 不删除 Artifact，只有没有 Role、Binding、Session 或回滚版本引用时才回收 Artifact。

### 9.6 Capability 配置契约升级

当前 `packages/contracts/src/capability.ts` 的 `configurationDefinitionSchema` 适合简单键值，但不足以表达嵌套对象、条件字段、认证方式切换和 UI 提示。需要增加 V2 配置契约，同时为当前数组格式保留兼容读取器。

目标类型：

```ts
interface CapabilityConfigurationContract {
  schemaVersion: 1;
  // JSON Schema 2020-12 的受支持子集；由 Hub 和 Desktop 同时校验。
  jsonSchema: Record<string, unknown>;
  // 只允许 Nova 内置组件，不接受能力提供方注入 HTML 或 JavaScript。
  uiSchema?: Record<
    string,
    {
      widget?: 'text' | 'textarea' | 'number' | 'switch' | 'select' | 'multiselect' | 'url';
      order?: number;
      placeholder?: string;
      help?: string;
      advanced?: boolean;
    }
  >;
  allowMultipleBindings: boolean;
  supportedScopes: Array<'deployment' | 'user' | 'project' | 'session'>;
  defaults?: Record<string, unknown>;
}

interface CredentialDefinition {
  id: string; // 逻辑字段名，例如 access-token，不是实际 Secret Reference
  displayName: string;
  description?: string;
  kind:
    'password' | 'api-key' | 'bearer-token' | 'basic-username' | 'oauth2' | 'client-certificate';
  required: boolean;
  supportedScopes: Array<'deployment' | 'user' | 'project' | 'session'>;
  provider: 'local-vault' | 'environment' | 'enterprise-broker';
  rotation?: {
    expiresAtRequired?: boolean;
    warnBeforeDays?: number;
  };
}
```

配置字段与凭据字段必须分开声明：

```text
configurationContract.jsonSchema
  endpoint、projectKeys、readOnly、timeoutMs 等非敏感值

credentials
  password、token、clientSecret、privateKey 等敏感值
```

禁止通过 `jsonSchema` 中普通的字符串字段伪装密码。Hub Manifest 校验器发现 `password`、`token`、`secret`、`privateKey` 等高风险字段名称但未声明为 Credential 时，应标记 `needs-review`；管理员可以明确豁免误报，但不能静默通过。

V1 到 V2 的迁移规则：

```text
configuration[]
→ 转换为顶层 object 的 properties/required

secrets[].key = NOVA_JIRA_TOKEN
→ credential.id = access-token
→ legacyStaticRef = NOVA_JIRA_TOKEN

新创建的 Binding
→ 不再共享 legacyStaticRef
→ 为每个 Binding 生成独立 Secret Reference
```

### 9.7 Capability Binding 数据结构

新增到 `packages/contracts/src/binding.ts`：

```ts
interface CapabilityBinding {
  apiVersion: 'harness.nova/v1';
  kind: 'CapabilityBinding';
  metadata: {
    id: string;
    displayName: string;
    scope: 'deployment' | 'user' | 'project' | 'session';
    tenantId?: string;
    userId?: string;
    workspaceId?: string;
    createdAt: string;
    updatedAt: string;
  };
  spec: {
    capability: {
      id: string;
      version: string;
      digest: string;
    };
    configuration: Record<string, unknown>; // 永远不含 Secret
    credentialRefs: Record<string, string>; // credential.id → Secret Reference
    enabled: boolean;
  };
  status: {
    phase: 'draft' | 'configuration-required' | 'testing' | 'ready' | 'error' | 'disabled';
    configurationChecksum?: string;
    lastTestedAt?: string;
    lastError?: {
      code: string;
      message: string;
      // 不允许包含 URL Query、Header、环境变量或响应正文原文。
    };
  };
}
```

示例：同一个 `jira-mcp@2.3.1` 可以只有一份 Artifact，但有三份 Binding：

```text
jira-personal       user scope       个人账号，可写
jira-rd             project scope    研发项目，只读
jira-production     deployment scope 生产环境，只读且强制审批
```

Hub Catalog 显示“能力”，Desktop 的“我的连接/项目连接”显示 Binding。两者在 UI 上不能混成一个概念。

### 9.8 Role Binding Slot 与 Session 固定

共享 Role 不能直接包含某个用户的 `bindingId`，也不能包含 Secret Reference。Role 中声明逻辑 Slot：

```yaml
capabilities:
  required:
    - id: jira-mcp
      range: ^2.3.0
      reason: 查询和更新研发任务
      binding:
        slot: issue-tracker
        required: true
        allowedScopes: [project, user]
        selection: project-first
```

RoleLock 只保存：

```ts
interface RoleCapabilityBindingRequirement {
  capabilityId: string;
  bindingSlot: string;
  required: boolean;
  allowedScopes: Array<'deployment' | 'user' | 'project' | 'session'>;
  configurationConstraints?: Record<string, unknown>;
}
```

新建 Session 时由 Desktop 解析 Slot：

```text
Session 临时选择
> Project 默认 Binding
> User 默认 Binding
> Deployment 默认 Binding
> 无可用 Binding 时弹出配置向导
```

解析结果写入 Session Activation Event：

```ts
interface SessionCapabilityResolution {
  roleLockChecksum: string;
  bindings: Array<{
    slot: string;
    bindingId: string;
    capabilityId: string;
    capabilityVersion: string;
    configurationChecksum: string;
    credentialRevision: string; // 版本标识，不是 Secret
  }>;
}
```

已有 Session 不因用户修改默认 Binding 而静默切换。凭据轮换允许保持同一 `bindingId`，但必须增加 `credentialRevision`，并通过受控重连事件更新 Session 的连接世代。

### 9.9 配置作用域、覆盖顺序与锁定字段

非敏感配置的合并顺序：

```text
Manifest defaults
→ Deployment defaults
→ Role defaults
→ Project Binding
→ User Binding
→ Session temporary override
→ Deployment enforced values
```

最后一层 `Deployment enforced values` 永远拥有最高优先级，用于强制：

- 生产 Jira 必须只读；
- Wiki MCP 只能访问指定 Space；
- Endpoint 必须位于内网域名；
- TLS 校验不能关闭；
- 超时、最大结果数量和并发上限；
- 禁止用户传入任意 executable、Header 名或代理地址。

Schema 需要支持：

```ts
interface NovaConfigurationExtension {
  'x-nova-merge'?: 'replace' | 'deep-merge' | 'set-union';
  'x-nova-lock'?: boolean;
  'x-nova-scope'?: Array<'deployment' | 'user' | 'project' | 'session'>;
  'x-nova-restart'?: 'none' | 'reconnect' | 'agent' | 'desktop';
}
```

数组默认 `replace`，不能隐式拼接。未知字段默认拒绝，不能把它们原样传给进程环境或 MCP Server。

Secret 不参与普通配置深度合并。每个 Credential 字段独立选择来源和作用域，最终只得到一个 Secret Reference。

### 9.10 本地存储布局

Binding 配置属于 Nova Home，不能默认写入项目 Git 工作区：

```text
<Nova Home>/
├─ bindings/
│  ├─ deployment/<binding-id>.json
│  ├─ user/<user-id>/<binding-id>.json
│  ├─ project/<workspace-id>/<binding-id>.json
│  └─ session/<session-id>/<binding-id>.json
├─ config/
│  ├─ secrets.dpapi.json       # Windows，只含 DPAPI 密文
│  └─ bindings.index.json
└─ state/
   └─ binding-health.json      # 只含脱敏状态
```

Binding JSON 可以同步或备份，但其中只能存在 `credentialRefs`。Secret Value 只允许位于：

- Windows DPAPI CurrentUser；
- macOS Keychain；
- 企业 Credential Broker/Vault；
- 本次 Session 内存，用于明确选择“不保存”的凭据。

项目目录中如果需要共享配置，只写不含 Secret 的声明：

```yaml
# .nova/project.yaml
bindings:
  issue-tracker:
    capability: jira-mcp
    requiredConfiguration:
      projectKeys: [NOVA]
```

不能写 `credentialRef`，避免把个人 Secret 标识或组织 Vault 路径提交到 Git。

### 9.11 Secret Reference 规范与当前代码修正

当前契约的 `secretReferenceSchema` 允许 `:`、`/` 等字符，但 `EncryptedFileSecretStore.normalizeKey()` 只接受字母开头的字母、数字、下划线、点和横线，两处规则不一致。Desktop 接入前必须统一，否则同一 Secret Reference 在 Windows 和 macOS/Linux 上可能表现不同。

Nova Desktop 统一使用自动生成的、跨平台安全的引用：

```text
NOVA_<CAPABILITY>_<BINDING_ID>_<CREDENTIAL>
```

例如：

```text
NOVA_JIRA_MCP_01K5ABCDEF_ACCESS_TOKEN
NOVA_WIKI_MCP_01K5XYZ123_PASSWORD
```

规则统一为：

```regex
^[A-Z][A-Z0-9_]{1,127}$
```

需要修改：

- `packages/contracts/src/common.ts`：收紧 `secretReferenceSchema`；
- `packages/secrets/src/encrypted-file-store.ts`：复用共享校验器，不再维护另一份 Regex；
- `packages/secrets/src/windows-dpapi-store.ts`：对键名执行同样校验；
- `apps/cli/src/config/environment-secrets.ts`：只做兼容读取，不再把不同引用静默映射到同一个环境变量；
- 增加旧引用迁移表，迁移后保留一次只读回退窗口。

Secret Store 还需要增加事务接口：

```ts
interface SecretTransaction {
  set(reference: string, value: string): Promise<void>;
  delete(reference: string): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}
```

配置 Apply 时应原子提交 Binding 与 Vault。Revision、OperationReceipt 和日志中只记录 Secret Reference、字段 ID、是否已配置和 revision，不记录旧值或新值。

### 9.12 Desktop 动态配置表单

Nova UI 不为每个 MCP 手写页面。统一的 `CapabilityConfigurationForm` 从以下信息生成表单：

```text
Capability configurationContract
+ credentials definitions
+ Deployment defaults/enforced fields
+ 当前 Scope
+ 已有 Binding 状态
```

表单交互要求：

- Secret 输入框永远不回显原值，只显示“已配置/未配置/即将更新”；
- 编辑非敏感字段时不要求重新输入未变化的 Secret；
- 可选择“使用个人凭据”“使用项目凭据”或“企业统一登录”，但只显示管理员允许的来源；
- OAuth 使用系统浏览器和 PKCE，不在内嵌 WebView 收集密码；
- Basic Auth 的用户名和密码都可以按企业策略设为 Secret；
- 显示字段来源，例如“角色默认”“项目覆盖”“企业强制”；
- 锁定字段只读并解释锁定原因；
- 保存前显示将新增的网络目标、进程、环境变量和工具权限；
- `Test Connection` 必须是独立动作，不能在每次键入时自动携带凭据请求远端。

内部状态与用户文案分开。Artifact 已下载但配置未完成时，不能向用户显示“已安装”：

```text
internal: absent                  UI: 安装
internal: artifact-installed      UI: 配置未完成
internal: draft                   UI: 继续配置
internal: testing                 UI: 正在测试
internal: ready                   UI: 已安装 · 可用
internal: credential-expiring     UI: 凭据即将过期
internal: error                   UI: 修复配置
internal: policy-disabled         UI: 被策略禁用
```

### 9.13 一键安装和配置时序

AI Hub 中点击“添加”后的完整流程：

```text
1. Desktop 向 Hub 请求 Capability、版本、Schema、风险和权限需求
2. Resolver 生成安装与配置 Plan
3. UI 展示来源、签名、网络、进程、工具权限和是否需要账号
4. 用户确认
5. Installer 下载并校验 Artifact，写入不可变 Store
6. 若无配置和 Credential：创建 ready Binding，直接激活
7. 若有配置或 Credential：创建 draft Binding，打开动态表单
8. Renderer 将非敏感值和 Secret 输入分成两个对象提交给 Local Host
9. Local Host 再次执行 JSON Schema、Scope、网络和企业策略校验
10. Secret Transaction 生成引用并加密保存，Binding 只写引用
11. 执行 safe Health Check / Test Connection
12. 成功：Binding 变为 ready，生成 RoleLock/Preset，刷新当前能力
13. 失败：Binding 保留为 error/draft，不激活到 Agent；允许修改后重试
```

Plan 应新增操作：

```text
install-capability-artifact
create-capability-binding
update-capability-binding
set-binding-credential
test-capability-binding
activate-capability-binding
deactivate-capability-binding
delete-capability-binding
```

Artifact 安装成功但配置失败时不需要删除 Artifact，因为 Artifact 不包含账号信息且后续可以继续配置。Binding/Vault 的单次保存失败则必须整体回滚。

### 9.14 MCP Runtime Binding

MCP Binding 由 Hub Manifest 声明“如何映射”，由 Desktop 在运行时执行。Manifest 不能提供任意模板代码，只能使用有限的声明式映射。

#### 9.14.1 Streamable HTTP / SSE

支持字段：

```ts
interface HttpMcpRuntimeBinding {
  transport: 'streamable-http' | 'sse';
  endpoint: { fixed?: string; fromConfiguration?: string };
  authentication?:
    | { type: 'bearer'; credential: string }
    | { type: 'basic'; usernameCredential: string; passwordCredential: string }
    | { type: 'api-key'; header: string; credential: string }
    | { type: 'oauth2-obo'; audience: string; scopes: string[] };
  headers?: Record<string, { fixed?: string; fromConfiguration?: string }>;
  timeoutMs?: { fixed?: number; fromConfiguration?: string };
}
```

执行规则：

- Endpoint 先经过 Schema 校验，再经过 Deployment Host Allowlist；
- `Authorization`、Cookie 和 API Key Header 只能由 Credential Provider 注入；
- Secret 只存在于创建请求的内存对象中，不写入 DSH 配置、RoleLock 或日志；
- 重定向后的 Host 重新校验，认证 Header 默认不跨 Host 转发；
- OAuth OBO 每次连接换取短期 Token，Desktop 不保存 Jira/Wiki 永久密码；
- 日志只记录 Host、Binding ID、状态码和耗时，不记录 Query、Header 与响应正文。

#### 9.14.2 stdio MCP

支持字段：

```ts
interface StdioMcpRuntimeBinding {
  transport: 'stdio';
  executable: { fromArtifactBin: string };
  args: Array<{ fixed: string } | { fromConfiguration: string }>;
  environment: Record<
    string,
    { fixed: string } | { fromConfiguration: string } | { fromCredential: string }
  >;
  inheritEnvironment: string[];
  workingDirectory: 'artifact' | 'workspace' | 'nova-temp';
}
```

执行规则：

- executable 必须来自已校验 Artifact Receipt，用户不能输入任意路径；
- `args` 必须使用数组，禁止 Shell 拼接；
- Secret 只能通过 `fromCredential` 注入目标子进程环境，不能放入参数；
- 子进程环境使用最小白名单，不能默认继承整个 Desktop Host 环境；
- Secret 只给该 Binding 的子进程，不能写入全局 `process.env`；
- 子进程退出后释放环境对象并清理临时目录；
- MCP Server 升级、崩溃或凭据轮换时，使用 DSH Connection Generation 做平滑重连。

### 9.15 Jira MCP 完整 Manifest 示例

下面是目标 V2 Manifest 的核心部分。该示例同时说明每个 MCP 可以拥有完全不同的表单和认证方式：

```yaml
apiVersion: harness.nova/v2
kind: Capability
id: jira-mcp
type: mcp
displayName: Jira
description: 查询和更新企业 Jira Issue
riskLevel: high

configurationContract:
  schemaVersion: 1
  allowMultipleBindings: true
  supportedScopes: [deployment, user, project]
  jsonSchema:
    type: object
    additionalProperties: false
    required: [endpoint, readOnly]
    properties:
      endpoint:
        type: string
        format: uri
        pattern: '^https://jira\\.corp\\.example/'
        title: Jira MCP 地址
      projectKeys:
        type: array
        items:
          type: string
          pattern: '^[A-Z][A-Z0-9_]{1,20}$'
        uniqueItems: true
        title: 允许访问的项目
      readOnly:
        type: boolean
        default: true
        title: 只读模式
        x-nova-lock: false
      timeoutMs:
        type: integer
        minimum: 1000
        maximum: 60000
        default: 15000
  uiSchema:
    endpoint:
      widget: url
      order: 10
    projectKeys:
      widget: multiselect
      order: 20
    readOnly:
      widget: switch
      order: 30
    timeoutMs:
      widget: number
      advanced: true

credentials:
  - id: access-token
    displayName: Jira Access Token
    kind: bearer-token
    required: true
    supportedScopes: [user, project]
    provider: local-vault
    rotation:
      warnBeforeDays: 7

versions:
  - version: 2.3.1
    manifestChecksum: '<sha256>'
    runtimeBindings:
      deepseek-harness:
        type: nova-mcp
        compatibility: '^0.1.6'
        configuration:
          transport: streamable-http
          endpoint:
            fromConfiguration: endpoint
          authentication:
            type: bearer
            credential: access-token
          timeoutMs:
            fromConfiguration: timeoutMs
```

如果 Jira MCP 使用账号密码，把 Credentials 改为：

```yaml
credentials:
  - id: username
    displayName: Jira 用户名
    kind: basic-username
    required: true
    supportedScopes: [user]
    provider: local-vault
  - id: password
    displayName: Jira 密码
    kind: password
    required: true
    supportedScopes: [user]
    provider: local-vault
```

如果企业支持统一认证，优先使用：

```yaml
authentication:
  type: oauth2-obo
  audience: jira-mcp
  scopes: [jira.read, jira.write]
```

此时用户只登录 Nova，不需要在 MCP 表单中输入 Jira 密码。

### 9.16 Skill 与 Plugin 的配置方式

#### 无配置 Skill

Manifest 不声明 `configurationContract` 和 `credentials`：

```text
点击添加
→ 下载/校验 SKILL.md 和资源
→ 创建 ready Binding
→ 加入角色
→ Skill Provider 立即可见
```

#### 有配置 Skill

例如代码评审 Skill 需要默认语言、目标分支和 GitLab Token：

- 默认语言、目标分支放 `configuration`；
- GitLab Token 放 Credential Store；
- Skill Provider 向 Skill 暴露非敏感配置；
- Skill 文本本身永远拿不到 Token；
- Skill 若需要访问 GitLab，应调用已绑定的 GitLab MCP/Tool，而不是把 Token 插入 Prompt。

因此优先的能力组合应是：

```text
Review Skill
→ 调用 gitlab-mcp
→ gitlab-mcp Binding 持有 Credential
```

而不是：

```text
Review Skill
→ 直接读取 GitLab Token
```

#### 无配置 Plugin

完成签名、风险和依赖检查后，由 DSH Plugin Manager 安装；如果支持热加载则直接启用，否则提示重启 Agent/Desktop。

#### 有配置 Plugin

继续使用统一 Binding：

- 非敏感值编译到该 Plugin 的 Cordis Row Config；
- Cordis 配置只保存 `credentialRef`，不保存明文；
- Plugin 通过 `ctx.novaCredentials.get(bindingId, credentialId)` 读取本次被授权的 Credential；
- Credential API 不提供 `list all`，Plugin 只能读取 Manifest 已声明并被策略允许的字段；
- Plugin 禁止自行写 Vault、导出 Secret 或把 Secret 返回给 Renderer。

需要特别说明：Host Plugin 与 Desktop Host 位于同一 Node 进程时，操作系统无法提供真正的内存隔离。因此只有企业审核并签名的高信任 Plugin 才能直接加载到 Host。第三方或低信任能力应使用 stdio 子进程、远程 MCP Gateway 或独立沙箱，不能仅依赖 TypeScript 接口实现安全隔离。

### 9.17 Hub API 与 Desktop Local API 分工

Hub 只管理定义、策略和组织级模板：

```text
GET  /api/v2/capabilities/:id
GET  /api/v2/capabilities/:id/configuration-contract
GET  /api/v2/capabilities/:id/versions/:version/runtime-binding
GET  /api/v2/configuration/defaults/:capabilityId
POST /api/v2/roles/resolve
POST /api/v2/credentials/token-exchange   # OAuth OBO/短期 Token
```

Desktop Local Host 管理本机 Binding 和 Secret：

```text
GET    /api/nova/bindings
GET    /api/nova/bindings/:id
POST   /api/nova/bindings/plan
POST   /api/nova/bindings
PATCH  /api/nova/bindings/:id
DELETE /api/nova/bindings/:id
PUT    /api/nova/bindings/:id/credentials/:credentialId
DELETE /api/nova/bindings/:id/credentials/:credentialId
POST   /api/nova/bindings/:id/test
POST   /api/nova/bindings/:id/activate
```

Renderer 只能调用 Local Host API，不能直接访问 DPAPI/Keychain 文件。Local API 复用 Desktop 的随机端口、Session Cookie、Origin 校验和 CSRF/nonce 机制。

Hub 绝不接收以下请求体：

```json
{
  "password": "...",
  "token": "...",
  "privateKey": "..."
}
```

组织共享凭据也不能存入 Catalog 数据库。它们位于 Vault/Credential Broker，Hub 只保存策略化的 Broker Handle，并向 Desktop 或 MCP Gateway 发放短期、限定 audience 和 scope 的 Token。

### 9.18 连接测试、凭据轮换与重连

每个 Runtime Binding 可以声明受控的 Health Check：

```ts
interface BindingHealthCheck {
  type: 'mcp-initialize' | 'http-status' | 'stdio-initialize' | 'oauth-introspect';
  safe: true;
  timeoutMs: number;
  expectedCapabilities?: string[];
}
```

测试规则：

- 默认只执行 MCP `initialize`、`tools/list` 或无副作用身份查询；
- 不执行 Jira 创建/更新、Wiki 写入等业务操作；
- 测试日志经过 Header、URL、JSON 字段和环境变量四层脱敏；
- 返回稳定错误码，如 `AUTH_REQUIRED`、`AUTH_INVALID`、`HOST_DENIED`、`TLS_FAILED`、`MCP_PROTOCOL_ERROR`；
- UI 展示可操作建议，但不展示远端包含敏感信息的原始响应。

凭据轮换：

```text
用户输入新凭据 / Broker 通知即将过期
→ 写入新 Secret Revision
→ 使用新 Revision 测试连接
→ 测试成功后切换 Binding credentialRevision
→ 当前调用完成
→ 建立新 MCP Connection Generation
→ 原子替换 Tool Generation
→ 删除或延迟回收旧 Secret Revision
```

测试失败时继续使用旧 Revision；不应因为一次错误输入中断当前正在工作的 Session。

### 9.19 对当前仓库的具体改造清单

`nova-harness`：

```text
packages/contracts/src/capability.ts
  - 增加 configurationContract、credentials V2
  - V1 configuration/secrets 兼容转换

packages/contracts/src/binding.ts
  - 新增 CapabilityBinding、Binding Slot、Session Resolution Schema

packages/contracts/src/state.ts
  - 增加 Binding Plan Operation 和 Binding Actual State

packages/core/src/binding-resolver.ts
  - Scope 解析、配置合并、锁定字段、Slot 选择

packages/core/src/configuration-validator.ts
  - JSON Schema 2020-12 子集校验和 Nova 扩展关键字

packages/secrets
  - 统一 Secret Reference 校验
  - Secret Transaction
  - Credential Revision
  - macOS Keychain Provider

packages/installer
  - Artifact 与 Binding Apply 分离
  - Binding Journal 中只记录引用和 checksum

apps/hub-api
  - 配置契约、组织默认值、Runtime Binding API
  - Broker Token Exchange
  - 禁止请求 DTO 接受 Secret Value
```

`nova-harness` 中的 Desktop 扩展包：

```text
packages/nova/binding-service
  - 本地 Binding CRUD、Plan/Apply、状态机

packages/nova/credentials
  - DPAPI/Keychain/Broker 聚合 Provider

packages/nova/mcp-binding
  - HTTP/SSE/stdio 声明式编译和连接世代

packages/nova/api
  - Desktop Local Binding API

packages/nova/ui-hub
  - AI Hub 添加流程和 CapabilityConfigurationForm

packages/nova/ui-role
  - Binding Slot 选择和缺失配置提示
```

必须增加的测试：

- 每种字段类型、条件字段、未知字段和锁定字段；
- 同一 MCP 多 Binding、多账号和多 Scope；
- Secret 不出现在 Hub、Binding、RoleLock、Preset、Revision、日志和错误中；
- DPAPI、Keychain、Broker 和环境变量来源；
- HTTP Header 注入、跨 Host 重定向剥离认证；
- stdio 只向目标子进程注入最小环境；
- 错误凭据不替换当前可用连接；
- 凭据轮换期间正在运行的 Tool Call 不被中断；
- 无配置 Skill/Plugin 一键启用；
- 有配置 Skill/Plugin 复用统一表单；
- Host Plugin 越权读取未声明 Credential 被拒绝；
- 离线状态下已有 Binding 可用，但不能完成需要在线 OAuth 的新配置。

### 9.20 DeepSeek Harness 原生适配规则

Nova 的 Capability Orchestrator 必须把 Hub 能力映射到 DeepSeek Harness 已有扩展点，不能在旁边再实现一套 Agent、Tool 或 Skill Runtime。

| Nova 能力        | DeepSeek Harness 接入点                            | Nova 负责                                 | 不允许的实现                                   |
| ---------------- | -------------------------------------------------- | ----------------------------------------- | ---------------------------------------------- |
| MCP              | `@deepseek-ai/dsh-mcp-client`，Agent Scope 实例    | Binding 解析、Credential 注入、连接世代   | 自建另一套 MCP Tool Registry                   |
| MCP Resource     | `ctx.mcpResources.register()`                      | 按 Binding 注册 Server Provider           | 绕开 DSH Resource Runtime                      |
| Skill            | `ctx.skills.registerProvider()`                    | 从 RoleLock 和 Artifact Store 提供 Skill  | 把所有 Skill 复制进用户目录后让用户维护        |
| Extension/Bundle | `ctx.pluginManager.installBundle()`、启用和 reload | Trust、Plan、UI 状态和安装编排            | Nova Installer 直接修改 Profile `node_modules` |
| Role             | DSH Agent Preset Root                              | RoleLock 编译为 Preset                    | 修改 Agent Loop 实现角色                       |
| Tool 权限        | DSH Tool Runtime、Sandbox、Approval Hook           | 企业策略合并和审计                        | 在 UI 层假装阻止 Tool Call                     |
| UI               | Cordis Client Plugin 和 keyed Slot                 | AI Hub、Role、配置表单、品牌              | 把 Vue Hub Admin 嵌入 React Client             |
| Session          | DSH Session/Event                                  | 记录 RoleLock 与 Binding Resolution Event | 建立与 DSH Session 平行的聊天存储              |

具体接线：

```text
Nova Capability Orchestrator
├─ MCP Adapter
│  └─ 为每个 ready Binding 创建一个 dsh-mcp-client Agent Scope 实例
├─ Skill Adapter
│  └─ 通过 ctx.skills.registerProvider() 提供当前 RoleLock 的 Skill
├─ Extension Adapter
│  └─ 调用 ctx.pluginManager 安装、启用、禁用和热重载 Bundle
├─ Role Adapter
│  └─ 发布 content-addressed Agent Preset
└─ Policy Adapter
   └─ 在 DSH Tool 执行边界调用 Sandbox/Approval/Policy
```

#### MCP 适配

DeepSeek Harness 的 `dsh-mcp-client` 已经负责：

- stdio 与 Streamable HTTP Transport；
- MCP initialize；
- Tool List 同步；
- `mcp__<serverName>__<rawName>` 工具命名；
- Tool Generation 替换；
- MCP Result 到 Harness Tool Result 的转换；
- MCP Resource Provider 注册。

Nova 不复制这些代码。`@nova-cbb/dsh-mcp-binding` 只把 Capability Binding 编译为原生 MCP Client Config，并在连接前解析 Credential。

```text
Capability Binding
→ resolve non-secret configuration
→ resolve credentials in memory
→ compile native dsh-mcp-client config
→ create plugin in Agent Scope
→ wait for initialize + tools/list
→ expose tools to current Agent
```

#### Skill 适配

DeepSeek Harness 已支持 `ctx.skills.registerProvider()` 以及 `list/get/snapshot`。Nova Skill Provider 使用这些接口提供当前 Role 可见的 Skill：

```text
RoleLock capability digest
→ Nova Artifact Store
→ ctx.skills.registerProvider()
→ DSH Skill list/get/snapshot
→ 原生 Tool Skill 调用
```

安装或移除 Skill 后触发 Provider 快照失效；不重启 Desktop，不修改 Agent Loop。

#### Extension 适配

所有会进入 Desktop Host 的 Extension 必须打包成 DSH Bundle，并声明 `dsh.bundle.patch`。安装、启用、禁用和移除统一调用 DSH Plugin Manager。

Nova Installer 只负责制品 Trust、摘要和业务 Plan，不能和 DSH Plugin Manager 同时拥有 Profile 包目录。普通用户看到“安装”，内部执行：

```text
Nova Trust/Policy Check
→ ctx.pluginManager.inspect()
→ ctx.pluginManager.installBundle()
→ DSH reload()
→ 校验 Bundle Row active
→ 返回 ready
```

普通用户可搜索安装的 Extension 必须支持 DSH 热加载。必须重启整个 Desktop、修改 Electron Main 或获得系统级权限的扩展只能由管理员随 Nova Desktop 版本发布，不能作为普通 Hub 能力提供“一键安装”。

### 9.21 安装完成即直接可用的 Ready 契约

Nova UI 不能把“文件已下载”称为“安装成功”。Capability Orchestrator 对外只返回以下结果：

```ts
type CapabilityInstallResult =
  | {
      status: 'ready';
      capabilityId: string;
      bindingId: string;
      activatedRoleIds: string[];
    }
  | {
      status: 'needs-input';
      capabilityId: string;
      formId: string;
      missingFields: string[];
    }
  | {
      status: 'failed';
      capabilityId: string;
      code: string;
      retryable: boolean;
    };
```

只有同时满足以下条件才返回 `ready`：

1. Capability 版本与当前 DeepSeek Harness 版本兼容；
2. Artifact 已下载并通过签名、摘要、路径和 Trust 校验；
3. 所有必需非敏感配置已解析；
4. 所有必需 Credential 已存在且作用域匹配；
5. Capability 已通过对应的 DSH 原生扩展点注册；
6. Safe Health Check 成功；
7. MCP 已完成 initialize 和 tools/list，或 Skill 已出现在 DSH Skill Snapshot，或 Bundle Row 已 active；
8. RoleLock/Preset 已更新，新建 Session 能看到该能力；
9. 权限差异已经确认并写入可审计 Plan。

`needs-input` 不是安装成功。UI 收到它后立即在当前详情页打开配置抽屉，不跳转到 Settings。用户完成表单后，使用原 `planId` 继续执行剩余步骤。

#### 一键安装 Orchestrator

```text
POST /api/nova/capabilities/:id/install
  ↓
Compatibility Gate
  ↓
Hub Resolve + Local Plan
  ↓
Artifact Install
  ↓
Resolve Defaults / SSO / Existing Binding
  ├─ 缺少输入 → needs-input → 当前页面配置抽屉
  └─ 输入齐全
       ↓
DSH Native Registration
       ↓
Health/Visibility Verification
       ↓
RoleLock Refresh
       ↓
ready
```

安装 API 必须幂等。相同用户、Scope、Capability、版本和配置 checksum 的重复点击返回同一个 Binding，不重复安装包或创建连接。

#### DeepSeek Harness 兼容性门禁

Hub 中每个可安装版本必须声明：

```yaml
runtimeBindings:
  deepseek-harness:
    type: nova-mcp
    compatibility: '=0.2.0-rc.2'
```

搜索结果只展示兼容版本。开发和发布 CI 必须增加：

- Capability Manifest → DSH Native Config 契约测试；
- MCP stdio、Streamable HTTP 初始化与 Tool Visibility 测试；
- `ctx.skills` Provider 的 list/get/snapshot 测试；
- Plugin Manager install/enable/reload/rollback 测试；
- Role Preset 创建和新 Session 可见性测试；
- DSH 升级前后的 API/Schema 差异测试；
- Electron 安装包内 Production Closure 测试。

任何能力如果没有可用的 `runtimeBindings.deepseek-harness`、超出 Compatibility 范围或原生注册验证失败，AI Hub 必须显示“不兼容当前 Nova Desktop”，并禁用安装按钮，不能尝试降级为另一套自定义运行时。

### 9.22 GitLab 与私有 npm 的精准来源匹配

Nova 的来源约定固定为：

```text
GitLab Group
├─ skills/**     → Skill 仓库
└─ plugins/**    → Plugin/Extension 仓库

Private npm Registry
└─ @company/*-mcp → MCP npm 包
```

当前 `packages/source-gitlab` 已支持：

- `rootGroup + skillGroupPath + pluginGroupPath` 定位能力目录；
- `include_subgroups` 递归扫描；
- 通过 GitLab Project ID 区分仓库；
- 检查 Skill 的 `SKILL.md`；
- 当前检查 Plugin 的 `.claude-plugin/plugin.json`，Nova Desktop 目标实现需要升级为检查 DSH Bundle；
- 读取 `nova.manifest.yaml`、README、维护人和 Git Tag；
- 使用 SemVer Tag；没有 Tag 时固定默认分支 Commit SHA；
- 下载地址使用 GitLab Project ID 和 Commit SHA，而不是可移动分支名。

当前 `packages/source-npm` 已支持：

- npm Search API、Static Index 和 `seedPackages`；
- Scope 与 `packagePatterns` 过滤；
- 按完整 npm 包名读取 Packument；
- 读取每一个已发布版本的 tarball URL；
- 读取 npm `dist.integrity`；
- 根据 Role 的 SemVer Range 解析出一个精确版本；
- Registry Token 只通过 Secret Reference 获取。

这些是精准匹配的基础，但上线前必须把“发现结果”升级为不可变的 `Artifact Coordinate`：

```ts
interface ArtifactCoordinate {
  capabilityId: string;
  capabilityType: 'skill' | 'plugin' | 'mcp';
  sourceId: string;
  sourceKind: 'gitlab' | 'npm';
  sourceIdentity: string;
  version: string;
  immutableRevision: string;
  artifactSha256: string;
  manifestSha256: string;
  entryPath: string;
}
```

两个来源的 `sourceIdentity`：

```text
GitLab：<sourceId>:project:<numeric-project-id>
npm：   <sourceId>:package:<full-package-name>
```

示例：

```text
internal-gitlab:project:4812
internal-npm:package:@company/jira-mcp
```

路径和显示名称可以变化，`sourceIdentity` 不变。Capability 的公开 `id` 用于 Role 引用，但下载和审计必须同时携带 `sourceIdentity`，不能只根据显示名称或模糊搜索结果下载。

#### GitLab Skill/Plugin 精确定位

建议一个仓库对应一个 Capability：

```text
agent-assets/skills/vue-best-practices
├─ nova.manifest.yaml
├─ SKILL.md
└─ references/**

agent-assets/plugins/code-review
├─ nova.manifest.yaml
├─ package.json
├─ cordis.patch.yml
└─ lib/**
```

GitLab 中的 Nova Desktop Extension 必须是可由 DeepSeek Harness Plugin Manager 安装的 Bundle：

```json
{
  "name": "@company/nova-code-review-extension",
  "version": "1.2.0",
  "type": "module",
  "main": "lib/index.js",
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    }
  }
}
```

GitLab 可以继续作为源码和目录来源，但交给 Desktop 的必须是可信 CI 生成的预构建 Bundle Archive/npm tarball，不能在用户机器上直接执行仓库里的任意构建脚本。Hub Materialization 校验 `package.json`、`dsh.bundle.patch`、Patch 引用和 `lib` 入口后，再发布 Artifact Coordinate。

版本解析：

```text
Tag v1.4.2
→ SemVer 1.4.2
→ GitLab Tag 对应 Commit SHA
→ 按 Commit SHA 读取该版本 Manifest 和入口文件
→ 按 Commit SHA 生成 Archive
→ 计算 Archive SHA-256
→ 发布 ArtifactCoordinate
```

没有 SemVer Tag 时：

```text
默认分支 HEAD Commit
→ 0.0.0-<commit 前 12 位>
→ 只适合 experimental / needs-review
```

生产 Role 不允许依赖可移动分支。正式 Skill/Plugin 必须使用 SemVer Tag，并最终固定到 Commit SHA。

如果需要一个 GitLab Monorepo 发布多个 Skill/Plugin，Manifest 必须显式声明 Component：

```yaml
components:
  - id: frontend-review
    type: skill
    root: skills/frontend-review
    entry: SKILL.md
  - id: architecture-review
    type: skill
    root: skills/architecture-review
    entry: SKILL.md
```

不能根据目录名称自动猜测 Component，避免仓库调整目录后错误匹配。

#### 私有 npm MCP 精确定位

Deployment Profile 限定可发现包：

```yaml
sources:
  - id: internal-npm
    type: npm
    registry: https://npm.example.internal
    adapter: static-index
    scopes: ['@company']
    packagePatterns: ['@company/*-mcp']
    staticIndexUrl: https://npm.example.internal/-/nova-harness/index.json
```

推荐生产环境使用管理员维护的 Static Index，不依赖不同 Nexus/CNPM 实现质量不一的模糊 Search API：

```json
{
  "packages": ["@company/jira-mcp", "@company/wiki-mcp"]
}
```

用户搜索“Jira”只影响 UI 结果排序，真正安装使用：

```text
sourceId       = internal-npm
packageName    = @company/jira-mcp
version        = 2.3.1
tarball        = packument.versions['2.3.1'].dist.tarball
integrity      = packument.versions['2.3.1'].dist.integrity
manifestSha256 = sha256(packument.versions['2.3.1'].novaHarness)
```

`latest` 只决定推荐版本，不能作为安装请求。点击安装前，Plan 必须把 `latest` 解析成具体的 `2.3.1`，并锁定 tarball 和 digest。

MCP 包要求：

```json
{
  "name": "@company/jira-mcp",
  "version": "2.3.1",
  "bin": {
    "jira-mcp": "dist/server.js"
  },
  "novaHarness": {
    "id": "jira-mcp",
    "type": "mcp",
    "runtimeBindings": {
      "deepseek-harness": {
        "compatibility": "=0.2.0-rc.2"
      }
    }
  }
}
```

解压后必须再次读取包内 `package.json` 并验证：

```text
package.json.name === Plan.packageName
package.json.version === Plan.version
novaHarness.id === Plan.capabilityId
bin 中存在 Manifest 声明的入口
入口真实存在且位于解压目录内
实际 tarball digest === Plan.integrity / artifactSha256
```

任意一项不匹配都以 `ARTIFACT_IDENTITY_MISMATCH` 拒绝，不能只因为 tarball 下载成功就继续安装。

#### 依赖也必须可复现

当前 `ArtifactInstaller` 对 npm 包执行 `npm install --omit=dev --no-package-lock`，这会让范围依赖在不同日期解析到不同版本。正式 MCP 必须选择以下一种发布方式：

1. 推荐：MCP 发布为 standalone bundle，运行依赖已经构建进制品；
2. 包内携带经过审核的 `package-lock.json`，安装时使用 `npm ci --omit=dev --ignore-scripts`；
3. Hub 发布阶段解析完整依赖图和 digest，生成内部 lock，再由 Desktop 离线安装该 lock。

不满足其中任意一种的 npm MCP 只能标记为 `experimental`，不能进入企业默认 Role。

### 9.23 从搜索结果到下载的不可变链路

完整链路：

```text
Source Sync
→ 发现 GitLab Project ID / npm Package Name
→ 读取每个版本自己的 Manifest
→ 校验 Capability ID、类型和入口
→ 固定 Commit SHA / npm Exact Version
→ Hub Materialize Artifact
→ 计算 Archive SHA-256 / npm SRI
→ 管理员审核并发布 Catalog Version
→ AI Hub 搜索只返回 published 版本
→ Install Plan 锁定 ArtifactCoordinate + Catalog Checksum
→ Desktop 按 digest 下载
→ 解压后再次校验 identity、entry、manifest 和 digest
→ 写入 content-addressed Store
→ 注册到 DeepSeek Harness
```

推荐让 Hub 在同步后执行 Artifact Materialization，而不是让每台 Desktop 直接信任 GitLab Tag 或 npm `latest`：

```text
GitLab/npm
→ Hub Artifact Mirror
→ sha256:<digest>
→ Desktop GET /api/v2/artifacts/<digest>
```

这样每个用户下载的是同一份已经审核的字节，不会出现同步时看到一个版本、安装时远端制品已经变化的问题。

#### 当前实现必须修正的精准性缺口

在宣称“精准匹配”前，需要完成以下阻断项：

1. `GitLabSource.discover()` 目前只读取默认分支的 Manifest 和入口；必须改为对每个 Tag 的 Commit SHA 分别读取并生成 `manifestChecksum`。
2. `gitLabCapability()` 目前把默认分支的同一个 Manifest checksum 写给所有 Tag；必须改为版本级 Manifest 快照。
3. 同一个 GitLab SemVer Tag 如果后来指向另一个 Commit，当前 Upsert 会覆盖 `commitSha`；必须拒绝不可变版本重发布并产生安全告警。
4. npm Adapter 目前只用 `latest` 的 Manifest 生成 Capability 顶层信息；必须解析并校验每个版本自己的 `novaHarness`，禁止把新版配置错误套给旧版 tarball。
5. npm tarball 解压后目前只检查 `package.json` 和 `bin` 是否存在；必须强校验包内 `name/version/novaHarness.id` 与 Plan 一致。
6. 缺失 npm `dist.integrity` 的版本必须由 Hub Mirror 生成 `artifactSha256`，否则不得发布为 active。
7. Artifact 下载跨 Host 重定向时必须重新检查 allowlist，并移除原 Host 的 Authorization/PRIVATE-TOKEN，避免 Registry/GitLab Token 泄漏给对象存储域名。
8. Catalog 中两个来源声明相同 `capabilityId` 时必须进入冲突队列，由管理员选择；不能使用同步顺序静默覆盖。
9. npm 生产依赖必须有 lock 或 standalone bundle，不能继续使用不生成 lock 的浮动依赖安装作为正式发布路径。
10. GitLab Plugin 当前按 Claude Plugin 的 `.claude-plugin/plugin.json` 验证；Nova Desktop 必须改为验证预构建 DSH Bundle，并通过 DSH Plugin Manager 安装。

#### 精准下载验收标准

- 搜索 `jira` 后选择 `@company/jira-mcp@2.3.1`，安装收据中的包名、版本、SRI 和 Manifest checksum 完全一致；
- Role 要求 `^2.3.0` 时，Plan 解析出唯一具体版本，Apply 期间 Registry 新发布版本不会改变本次安装；
- GitLab `skill-a@1.2.0` 永远对应同一个 Project ID、Commit SHA 和 Archive SHA-256；
- 移动或删除 Tag 不影响已经发布和缓存的 Artifact；
- 同版本 Tag 被重指向另一个 Commit 时同步失败并报警；
- 同名 GitLab 项目、同名 npm 包或相同 Capability ID 不会串包；
- 下载后身份校验失败时，不写入 Store、不生成 Binding、不注册到 DSH；
- 离线安装包使用相同 Artifact Coordinate 和 digest，结果与在线安装一致。

## 10. 权限实现

### 10.1 权限层次

```text
Hub Entitlement
  决定用户能否看到和使用能力

Artifact Trust
  决定代码或配置能否进入 Desktop

Nova Runtime Policy
  决定本次 Tool Call 能否执行

目标系统权限
  决定 Jira/Wiki/GitLab 中能访问的真实业务数据
```

### 10.2 Tool Identity

统一动作命名：

```text
tool:fs/read
tool:fs/write
tool:shell/execute
mcp:jira/search_issues
mcp:jira/update_issue
mcp:wiki/search
mcp:wiki/update_page
extension:<package>/<action>
```

MCP 权限匹配使用稳定的 `serverName + raw tool name`，不能依赖 UI 显示名称。

### 10.3 Policy Enforcer

`@nova-cbb/dsh-policy` 监听 `tools/pre-execute` waterfall：

```text
接收 ToolExecution
→ 解析 Agent 对应 RoleLock
→ 标准化 action/resource
→ 合并企业、角色、项目、用户策略
→ 产生 allow / deny / requireApproval
→ 写本地审计事件
→ allow 时调用 next()
→ deny 时返回受控失败
→ requireApproval 时调用 ctx.approval.request()
```

优先级：

```text
企业 enforced deny
> Capability revocation
> Role deny
> Project deny
> requireApproval
> allow
> 默认 deny
```

当前 `PermissionRule` 可以继续使用，但需要补充标准条件字段：

```ts
interface PermissionConditions {
  environments?: string[];
  workspaceLabels?: string[];
  userGroups?: string[];
  dataClassifications?: string[];
  timeWindow?: { timezone: string; start: string; end: string };
  networkZones?: string[];
}
```

不能表达的规则返回 `unsupported` 并阻止 Role 激活，不能静默放行。

### 10.4 Sandbox

DSH Sandbox 继续负责：

- `read-only`
- `workspace-write`
- `danger-full-access`

Nova Role 把业务权限编译为 DSH Permission Preset：

```text
受限分析员 → read-only + ask
普通工程师 → workspace-write + ask
自动化任务 → workspace-write + never
高权限调试 → danger-full-access + ask
```

DSH Sandbox 不覆盖网络访问。网络出口通过以下方式控制：

- 远程 MCP Gateway。
- 企业代理。
- Hub 下发 Host allowlist。
- 高安全环境使用远端沙箱执行 shell/MCP。

## 11. 凭据与登录

### 11.1 Nova 登录

Desktop 使用 Authorization Code + PKCE：

```text
Nova Desktop
→ 打开系统浏览器
→ 企业 OIDC
→ nova://auth/callback 或 loopback callback
→ 获取短期 Access Token
```

Renderer 不持有 Refresh Token。认证流程由 Electron Main 或受信 Host 插件拥有。

### 11.2 本地存储

优先使用：

```text
Windows DPAPI
macOS Keychain
```

当前 Nova `packages/secrets` 可复用其 Secret Reference、DPAPI 和脱敏逻辑；跨平台后端需要增加 macOS Keychain 实现。

配置文件只允许出现：

```text
credentialRef: NOVA_JIRA_MCP_01K5ABCDEF_ACCESS_TOKEN
```

禁止出现 Token 明文。

### 11.3 凭据更新

Credential Provider 每次连接或敏感操作重新解析引用，不跨进程长期缓存。收到凭据更新事件后：

- 标记受影响 MCP Connection 需要重连。
- 等待当前调用结束。
- 创建新连接世代。
- 原子替换工具世代。

## 12. Hub 模式和纯离线模式

### 12.1 企业 Hub 模式

Desktop 调用现有 Hub 的演进版本：

```text
GET  /api/v2/catalog/search
GET  /api/v2/capabilities/:id
GET  /api/v2/roles
POST /api/v2/roles/resolve
POST /api/v2/installations/plan
GET  /api/v2/artifacts/:digest
GET  /api/v2/policy/snapshot
POST /api/v2/audit/batch
```

Hub 返回签名 RoleLock 和制品地址。Desktop 不直接访问 GitLab/npm 管理接口。

### 12.2 无 Hub 离线模式

Desktop 导入：

```text
nova-capability-pack/
├─ catalog.snapshot.json
├─ roles/
├─ policies/
├─ artifacts/
├─ signatures/
├─ revocations.json
└─ trust-roots/
```

离线模式限制：

- 只能使用包内或已缓存能力。
- 不允许创建需要服务端审批的共享角色。
- 高风险能力在策略过期后 fail closed。
- 审计先加密落盘，恢复连接后上传。

### 12.3 不嵌入 Hub API

不要在 Desktop Host 中启动当前 NestJS Hub API，原因：

- 引入 Prisma/PostgreSQL 和额外生命周期。
- 与 DSH Host 的 API/RPC 体系重复。
- 增加端口、升级、迁移和恢复复杂度。
- 单机 Catalog 只需要本地缓存和 DSH Storage，不需要完整服务端。

## 13. AI Hub 安装事务

点击“添加能力”后的实际流程：

```text
1. 查询 Capability 详情
2. 校验用户 Entitlement
3. Resolve 依赖、冲突和兼容范围
4. 展示新增权限、凭据、网络和脚本风险
5. 用户确认
6. 下载到 staging
7. 校验签名、digest、Manifest、归档安全
8. 安装 Profile Package 或写入不可变 Artifact Store
9. 生成新 RoleLock
10. 编译新 Agent Preset
11. 发布本地状态
12. 下一次新会话使用新角色版本
```

事务所有权：

- DSH Plugin Manager 唯一拥有 Desktop Profile 的 pnpm 依赖和 Bundle 列表。
- Nova Artifact Cache 拥有下载缓存和非 npm 内容。
- Nova Role Service 拥有 RoleLock 和生成的 Preset。
- 当前 Nova ApplyEngine 可作为高层 Journal，但不得直接修改 DSH `node_modules`。

失败处理：

| 阶段              | 处理                               |
| ----------------- | ---------------------------------- |
| 下载失败          | 删除 staging，保持旧角色           |
| 校验失败          | 隔离制品并记录审计                 |
| pnpm 失败         | 使用 DSH Plugin Manager 的恢复结果 |
| Preset 编译失败   | 保留已安装制品，不发布 RoleLock    |
| RoleLock 发布失败 | 当前 Session 和旧角色不受影响      |
| Host 重载失败     | 进入 Desktop 原生恢复流程          |

## 14. LLM 方案

Desktop 直接复用：

```text
@deepseek-ai/dsh-llm
@deepseek-ai/dsh-llm-deepseek
@deepseek-ai/dsh-agent-default-model
```

最终链路：

```text
Nova Model Policy
→ DSH ctx.llm route
→ DeepSeek Adapter 或企业 LLM Gateway
→ DeepSeek
```

`cc-switch` 不进入 Nova Desktop 核心链路。

如果需要兼容 Claude Code，可以把当前 `runtime-claude` 作为独立的外部 Runtime 或 Subagent Provider 保留，但不能让它控制 Nova 主会话的权限、凭据或审计。

Model Policy 至少包含：

- 用户和 Role 可用模型。
- 默认模型别名。
- 最大上下文和输出限制。
- 成本预算。
- 数据分级可用路由。
- 企业网关地址。
- 禁止用户覆盖的 enforced 字段。

## 15. 当前 Nova 仓库改造清单

### 15.1 保留

```text
packages/contracts
packages/core
packages/shared
packages/installer
packages/secrets
packages/source-gitlab
packages/source-npm
apps/hub-api
prisma
```

### 15.2 仅作为开发和运维工具保留

```text
apps/cli
apps/hub-admin
packages/runtime-claude
```

它们不进入 Nova Desktop 安装包。

### 15.3 新增

```text
packages/contracts/src/role-lock.ts
packages/contracts/src/policy.ts
packages/contracts/src/artifact.ts
packages/core/src/role-lock.ts
packages/core/src/dsh-preset-compiler.ts
packages/hub-sdk/
packages/artifact-client/
```

### 15.4 修改

`packages/contracts/src/capability.ts`：

- 增加 DSH Runtime Binding 的判别联合。
- 增加 declaredTools、network、artifact trust 元数据。
- 增加 minimumNovaVersion、minimumDshVersion。

`packages/contracts/src/profile.ts`：

- 把 Role 与 RoleLock 分离。
- 标准化 Permission Action。
- 增加 Workspace 和组织条件。

`apps/hub-api`：

- 新增 `/api/v2`。
- 引入 OIDC Principal。
- 增加 Entitlement 和策略过滤。
- 返回签名 RoleLock。
- 增加 Artifact 下载接口。

`packages/installer`：

- 保留下载、摘要、归档安全和 Journal。
- Profile Package 安装改为调用 DSH Plugin Manager 适配器。
- 禁止直接拥有 Desktop Profile 的 `node_modules`。

## 16. DeepSeek Harness 仓库改造清单

### 16.1 第一批必须修改

```text
apps/desktop/package.json
apps/desktop/src/main.ts
apps/desktop/src/paths.ts
apps/desktop/src/project-manager.ts
apps/desktop/src/locale.ts
apps/desktop/resources/*
apps/desktop/scripts/package-target.ts
apps/desktop/scripts/prepare-package-set.ts
apps/desktop-host/package.json
packages/nova/*
```

### 16.2 尽量不修改

```text
packages/bundle/base
packages/bundle/web-app
packages/core/*
packages/mcp/mcp-client
packages/skill/*
packages/interaction/*
packages/workspace/*
```

Nova 行为通过新 Bundle 的后置 Patch 和插件贡献完成。

### 16.3 需要复制上游标准 Preset 的部分

不要在生成器中手写一份逐渐过期的 `standard` Preset。

建议实现：

```text
标准 Preset 模板版本
→ Nova Role Compiler 读取受支持模板
→ 应用 Role Capability Patch
→ 生成独立 Preset
```

每次升级 DSH 时执行 Golden Diff，检查标准 Preset 新增、删除或改变的 Row。

## 17. 外网开发与内网导入策略

### 17.1 两个仓库如何推进

不采用以下两个极端：

- 不在两个仓库中同时铺开所有模块，避免契约每天变化、集成点失控；
- 不先把 Hub 全部做完再开始 Desktop，因为最终会发现 API 与 DSH 原生扩展点不匹配。

采用“契约先行、纵向切片、单产品仓闭环、上游镜像按需验证”的方式：

```text
每一个业务切片
  1. nova-harness 先定义/冻结契约和 Mock
  2. nova-harness 实现 Desktop Adapter/UI 消费端
  3. nova-harness 实现真实 Hub/Installer 行为
  4. 同仓运行 Contract/E2E Fixture
  5. 只有升级 DSH 或触发 Mode B 时才更新上游镜像/补丁
```

因此日常功能开发不需要两个仓库同时推进：

> 一个切片内在 `nova-harness` 先改 Contract，再改 Desktop Adapter/UI，再补 Hub 实现；`nova-dsh-upstream-mirror` 只在 Runtime 升级或确有 Core Patch 时进入工作流。

仓库职责固定：

| 仓库 | 做什么 | 不做什么 |
|---|---|---|
| `nova-harness` | Nova Desktop、Contract、Hub API、Source、Artifact、RoleLock、Binding、Bundle、UI、Adapter、Mock | 不重写 Agent Loop、Session 和 DSH Tool Runtime |
| `nova-dsh-upstream-mirror` | 镜像官方源码、验证目标 Tag、保存必要的最小 Patch Series | 不开发 Nova Role、Hub、UI 和企业产品功能 |

两个仓库不能使用相对路径直接引用源码。跨仓依赖只通过版本化制品：

```text
@nova-cbb/harness-contracts-<version>.tgz
OpenAPI JSON
Capability/Role/Binding JSON Schema
Mock Hub responses
Contract fixture checksums
```

### 17.2 当前本地状态与开始前必须做的事

当前检查结果：

```text
E:\ai\nova-harness
  branch: master
  commit: 无初始 commit
  status: 所有文件均为 untracked

E:\ai\deepseek-harness
  branch: master
  commit: ddefc45fbc7f8e46dd73185e68295696d1297887
  tag: dsh-v0.1.6-alpha.2
  status: clean
  origin: DeepSeek 官方 GitHub
```

必须先完成基线治理：

1. 清理并确认 `nova-harness` 的 `.gitignore`，不要把数据库、Token、`.env`、缓存、构建产物和本地日志提交进去；
2. `nova-harness.7z`、Docker Image tarball 等大制品放 Release/制品库，不作为普通源码提交；
3. 在外网对 `nova-harness` 跑完现有 lint、typecheck、test、build，保存结果；
4. 创建第一个只包含当前可公开代码的 Initial Baseline Commit 和 Tag；
5. 给 `deepseek-harness` 建立自有只读镜像，官方仓库作为 `upstream`，内网镜像作为可审计来源；
6. 从固定 Commit 创建 `validate/dsh-0.2.0-rc.2` 做升级验证；只有进入 Mode B 时才创建 Nova Patch 分支，不在官方 `master` 开发；
7. 生成两仓共同的 `integration-lock.json`。

建议的远端语义：

```text
deepseek-harness mirror
├─ upstream  → https://github.com/deepseek-ai/deepseek-harness.git，只拉取
└─ origin    → 自己控制的 nova-dsh-upstream-mirror，仅同步官方版本和审计后的 Patch
```

在配置好自有镜像前，不要向当前指向官方 GitHub 的 `origin` 推送任何 Commit。Nova 产品 Commit 只进入 `nova-harness`。

### 17.3 跨仓集成锁

两个仓库各保存同一份逻辑内容的 `integration-lock.json`：

```json
{
  "releaseTrain": "NOVA-DESKTOP-0001",
  "novaHarness": {
    "commit": "<external-nova-harness-commit>",
    "contractsVersion": "0.2.0-dev.1",
    "apiVersion": "harness.nova/v2"
  },
  "deepseekHarness": {
    "upstreamCommit": "639ed015397290b3745d163aafe02ffee4aa3f84",
    "version": "0.2.0-rc.2",
    "npmIntegrity": "sha512-EAJ3gPNcVt/uv8X19PMm9NkVhWgT7xXNMk0UKCVm+IQ5rpSQOcsMUa0HWlnYYVybKMsccjcRB21vVVsaXQ6IdA==",
    "sourcePatchCommit": null
  },
  "fixtures": {
    "catalogChecksum": "sha256:<digest>",
    "contractChecksum": "sha256:<digest>"
  }
}
```

Desktop 启动时调用：

```text
GET /api/v2/meta/compatibility
```

Hub 返回：

```json
{
  "apiVersions": ["harness.nova/v2"],
  "minimumDesktopVersion": "0.1.0",
  "contractsVersion": "0.2.0-dev.1",
  "manifestVersions": [1, 2]
}
```

版本不兼容时在 UI 明确提示，不能等到安装 MCP 时才发生难以理解的错误。

### 17.4 外网第一轮开发顺序

第一轮只做一条最小链路，不同时开发完整权限、所有角色和全部企业源。

#### 第 1 步：建立可迁移基线，1～2 天

`nova-harness`：

- 建立 Initial Baseline Commit；
- 记录 Node、pnpm、PostgreSQL 和 Schema 版本；
- 确认 Mock GitLab/npm/MCP 可以运行；
- 生成当前测试报告。

`deepseek-harness`：

- 创建 Nova fork 分支；
- 固定官方 Commit；
- 原样构建一次 DSH Desktop；
- 保存安装包内容和测试结果，作为改造前证据。

#### 第 2 步：冻结第一版跨仓契约，2～3 天

只在 `nova-harness` 修改：

- `ArtifactCoordinate`；
- `CapabilityInstallResult`；
- `RoleLock`；
- `CapabilityBinding`；
- `/api/v2/meta/compatibility`；
- 搜索、详情、安装 Plan 的 Mock Response；
- 发布 `@nova-cbb/harness-contracts` tgz。

这一步不等待真实 Hub 逻辑全部完成。

#### 第 3 步：先让 Nova Desktop 壳跑起来，3～5 天

只在 `nova-harness` 的 `apps/nova-desktop` 和 Nova 扩展包中修改：

- Nova Product Name、App ID、Protocol、Nova Home；
- Nova Desktop Bundle；
- AI Hub 空页面；
- 使用 Mock Hub 展示一个 Skill 和一个 MCP；
- 点击安装后显示确定性的 `ready/needs-input/failed` 状态。

这一阶段不连接真实 GitLab/npm，以便先验证 DSH UI Slot、Bundle、Profile、打包和 Session 边界。

#### 第 4 步：接通第一个真实纵向切片，1～2 周

按以下顺序交替提交：

```text
nova-harness
  → GitLab Skill 精确版本与 Artifact API

nova-harness / Desktop packages
  → Skill Provider + AI Hub 安装 UI

nova-harness
  → npm MCP 精确版本、Binding 和 Mock Credential

nova-harness / Desktop packages
  → dsh-mcp-client Adapter + 配置抽屉

Nova E2E
  → Wiki Search / Jira Readonly E2E
```

第一条切片通过后，再做 OIDC、企业权限、审计、更新和更多角色。

### 17.5 外网仓库与内网仓库的分支模型

外网：

```text
nova-harness
├─ main
├─ feature/train-0001-contracts
└─ feature/train-0001-desktop

nova-dsh-upstream-mirror
├─ upstream/master
├─ mirror/official-tags
└─ validate/dsh-0.2.0-rc.2
```

内网不要直接把外网分支设为主分支：

```text
nova-harness-internal
├─ mirror/external-main       # 只接收外网 Bundle，不加内网改动
├─ internal/main              # 内网正式主干
└─ integrate/train-0001       # 本次导入与冲突处理

nova-dsh-upstream-mirror-internal
├─ mirror/upstream-dsh        # 官方 DSH 镜像
├─ internal/approved-tags     # 已准入版本
└─ patch/dsh-*                # 仅 Mode B
```

`mirror/*` 必须保持导入内容原样，不能混入内网修改。这样出现问题时可以判断是外网提交问题、导入冲突，还是内网 Overlay 问题。

### 17.6 如何处理内网已经存在的不同修改

不把内网代码整体拿到外网，也不能假设外网 Commit 可以无冲突覆盖内网。

先在内网生成一份不含业务源码和 Secret 的 Delta Inventory：

```yaml
repository: nova-harness
externalBase: '<当初带入内网时的 commit 或 release>'
internalHead: '<内网 commit>'
touchedAreas:
  - contracts
  - hub-api/auth
  - source-gitlab
  - deployment-manifests
schemaVersions:
  database: 3
  capabilityManifest: 1
  api: v1
customizations:
  - id: internal-oidc
    boundary: provider
  - id: internal-gitlab-ca
    boundary: deployment
```

只需要把以下非敏感信息反馈给外网开发：

- 当初导入的外网 Commit/版本；
- 内网修改涉及的模块和公开接口；
- API、Manifest、数据库 Schema 版本；
- 失败测试的错误码和脱敏堆栈；
- 内网必须保留的扩展点约束。

禁止带出：

- 内网域名、Token、证书私钥；
- Jira/Wiki 数据；
- 员工账号与组织结构；
- 未经批准的内部源代码；
- 完整生产日志和数据库快照。

内网定制尽量收敛到以下 Overlay 边界：

```text
Deployment Profile
Credential Provider
OIDC Provider
Catalog Source Adapter
Policy Provider
Brand/Feature Flag
```

避免内网直接改 Agent Loop、通用 Contract Resolver 和 DSH MCP Client。确实必须修改时，单独维护 `internal/*` Commit，不与外网可移植 Commit 混在一起。

### 17.7 外网交付包

每一个 Release Train 生成独立离线交付目录：

```text
NOVA-DESKTOP-0001/
├─ manifest.json
├─ checksums.sha256
├─ repositories/
│  ├─ nova-harness.bundle
│  └─ nova-dsh-upstream-mirror.bundle   # 仅新 DSH Tag 或 Mode B Patch 时需要
├─ patches/
│  ├─ nova-harness/*.patch
│  └─ nova-dsh-upstream-mirror/*.patch  # 仅 Mode B
├─ contracts/
│  ├─ harness-contracts-0.2.0-dev.1.tgz
│  ├─ openapi.v2.json
│  └─ schemas/**
├─ migrations/
│  ├─ database.md
│  ├─ configuration.md
│  └─ breaking-changes.md
├─ tests/
│  ├─ external-test-report.json
│  ├─ contract-fixtures/**
│  └─ internal-acceptance.ps1
├─ sbom/
└─ THIRD_PARTY_NOTICES.txt
```

同时提供 Git Bundle 和 Format Patch：

- Git Bundle 用来完整传输 Commit、Tag 和祖先关系；
- Format Patch 用于内网分支偏离较大时逐提交审查和三方应用；
- 每个文件写 SHA-256；
- 交付包签名；
- 不传输外网 `node_modules` 和开发缓存；
- npm/Container/Electron 制品放单独 Artifact 区并生成 SBOM。

### 17.8 内网导入顺序

内网每次导入都走独立集成分支：

```text
1. 校验交付包签名和 checksums.sha256
2. 导入两个 Git Bundle 到 mirror/*
3. 核对 external base 与 internal merge-base
4. 创建 integrate/train-0001
5. 先导入 nova-harness Contract/Schema Commit
6. 执行数据库和配置 Dry Run Migration
7. 导入 Hub/Source/Artifact Commit
8. 导入 nova-harness Desktop/Adapter Commit；若本次包含新 DSH，再导入已审计的官方 Tag/Mode B Patch
9. 按 internal/* Overlay 解决冲突
10. 运行 Contract、Unit、E2E、Desktop Package 和安全扫描
11. 生成 Internal Porting Report
12. 合并 internal/main 并打 internal-import Tag
```

不要在内网直接解压外网源码覆盖目录，也不要把两个仓库压成一个 Commit。这会丢失 Commit 边界，后续无法判断冲突来源。

如果内网 DSH 基线仍不是目标 `639ed015...`：

1. 先比较内网基线与外网基线的 DSH API、Profile、Bundle、MCP、Skill 和 Session 差异；
2. 能升级时先将内网 DSH 对齐到外网固定基线；
3. 不能升级时，将外网 Nova Commit 作为 Patch Series 逐项移植；
4. 每个移植 Commit 记录原 Commit SHA 和差异原因；
5. 不要强行 Merge 两个无共同基线的大目录快照。

### 17.9 每个切片的提交和交付边界

一个切片至少形成以下提交，而不是一个跨仓大提交：

```text
nova-harness
1. feat(contracts): add <slice> contract
2. feat(hub): implement <slice> API
3. test(contract): add <slice> fixtures
4. feat(desktop-adapter): consume <slice> contract
5. feat(desktop-ui): add <slice> experience
6. test(desktop): verify <slice> with fixture

nova-dsh-upstream-mirror（仅上游升级或 Mode B 时）
1. chore(upstream): pin official <tag>
2. fix(patch): add bounded compatibility patch
3. test(upstream): verify patch removal condition
```

两仓通过 `releaseTrain + contractsVersion + fixtureChecksum` 关联。任何一个切片如果无法在 Mock 环境运行，就不能打包带入内网。

### 17.10 推荐现在就执行的启动清单

按顺序开始：

1. 给当前 `nova-harness` 建立安全、可测试的 Initial Baseline Commit；
2. 给 `deepseek-harness` 配置自有只读镜像，并验证/固定官方 upstream Commit；
3. 新增两仓 `integration-lock.json` 和 `UPSTREAM.md`；
4. 先实现/冻结 `ArtifactCoordinate + InstallResult + Compatibility API`；
5. 在 DSH fork 创建 Nova Desktop Bundle 和一个只读取 Mock Hub 的 AI Hub 页面；
6. 打通“搜索一个 Mock Skill → 安装 → `ctx.skills` 可见”；
7. 生成第一份 `NOVA-DESKTOP-0001` 离线交付包；
8. 在内网集成分支试导入，记录冲突；
9. 根据第一次 Porting Report 调整 Provider/Overlay 边界；
10. 再开始真实 GitLab Skill 和 npm MCP。

第 6 步是第一个技术里程碑。它同时验证外网代码能开发、两个仓库能协作、DeepSeek Harness 接入正确、交付包能进入内网。不要在这个里程碑前投入完整 Jira、Wiki、权限和审计开发。

## 18. 开发阶段

### 阶段 0：基线冻结，2～3 天

任务：

- 为 DeepSeek Harness 镜像建立 `validate/dsh-0.2.0-rc.2` 验证分支；只有 Mode B 才建立 `patch/dsh-0.2.0-rc.2`。
- 记录 DSH commit、version 和 Node/pnpm 版本。
- 建立上游同步说明。
- 为 Nova 包确定 namespace。
- 确认 Windows 首发，macOS 是否同期支持。

交付：

- `UPSTREAM.md`
- `nova-runtime.json` schema
- 可重复的原版 DSH Desktop 开发启动

验收：

```powershell
cd E:\ai\deepseek-harness
pnpm install
pnpm run build
pnpm run dev:desktop
```

### 阶段 1：Nova 品牌 Desktop，1 周

任务：

- 产品名、应用 ID、图标和协议替换。
- Nova Home 隔离。
- 创建 Nova Desktop Bundle。
- 创建 Nova Brand UI Plugin。
- Desktop Profile 固定带 Nova Bundle。
- 原生恢复保留 Nova 基础 Bundle。

验收：

- 启动后显示 Nova 品牌。
- 不写入用户 `~/.dsh`。
- About 显示 Nova 和绑定的 DSH 版本。
- 禁用第三方插件恢复后 Nova 仍可启动。

### 阶段 2：Role 最小闭环，1～2 周

任务：

- 新增 RoleLock。
- 实现 Role Compiler。
- 生成 `nova-general` 和 `nova-frontend` Preset。
- 新会话页显示角色选择。
- Session 开始后锁定角色。

验收：

- 两个角色看到不同 Tool/Skill 集合。
- 修改角色后只影响新 Session。
- 重启 Desktop 后旧 Session 可按原 Lock 恢复。

### 阶段 3：AI Hub、来源锁定与 Skill，2～3 周

任务：

- 实现 Hub SDK。
- 实现本地 Catalog Cache。
- 实现 AI Hub React 页面。
- 实现 Skill Provider。
- 实现添加/移除 Capability 的 Plan UI。
- GitLab 按每个 SemVer Tag 的 Commit 读取 Manifest 和入口。
- npm 按每个 Exact Version 解析 `novaHarness` 和 SRI。
- 增加 Artifact Coordinate、同 ID 冲突隔离和不可变版本重发布检测。
- 增加 Hub Artifact Mirror/Materialization。

验收：

- 可搜索内网 Skill。
- 添加 Skill 后生成新 RoleLock。
- 断网后已缓存 Skill 仍可用。
- 摘要或签名错误的 Skill 被拒绝。
- GitLab Skill/Plugin 的 Project ID、Commit SHA、Manifest SHA 和 Archive SHA 完全锁定。
- npm MCP 的 Source、完整包名、Exact Version、SRI 和包内 Identity 完全一致。
- Registry 新发布版本不会改变已经生成的 Install Plan。
- 同版本重发布或 Capability ID 冲突被拒绝并产生审计告警。

### 阶段 4：Capability Binding、MCP 与凭据，3～4 周

任务：

- 实现 Capability Configuration Contract V2 和 V1 兼容转换。
- 实现 Capability Binding、Binding Slot 与 Scope Resolver。
- 实现统一动态配置表单。
- 统一 Secret Reference 校验并实现 Secret Transaction。
- 实现 MCP Binding。
- 实现 Streamable HTTP/SSE 与 stdio 声明式映射。
- 接入 Jira Readonly MCP。
- 接入 Wiki Search MCP。
- 实现 OIDC/PAT Credential Flow。
- 实现同一 MCP 多账号、多环境 Binding。
- 实现 Credential Revision、测试后切换和连接世代重建。
- 实现连接状态和 Doctor UI。

验收：

- Token 不进入 YAML、日志和 Session。
- Hub API 和 Catalog 数据库不接收用户 Secret Value。
- 同一 Jira MCP 可创建个人、项目和生产只读 Binding，Artifact 只安装一次。
- Role 通过 Slot 选择 Binding，缺少必需 Binding 时不能启动 Session。
- 无配置 Skill/Plugin 一键启用，有配置时复用统一表单。
- HTTP MCP 不向跨 Host 重定向转发认证 Header。
- stdio MCP 只向自己的子进程注入声明过的 Secret 环境变量。
- 错误的新凭据不会替换当前仍可用的连接。
- 不同用户获得各自 Jira/Wiki 权限。
- MCP 崩溃后按 DSH 机制重连。
- Capability 被移除后新 Session 不再出现其工具。

### 阶段 5：企业权限与审计，2～3 周

任务：

- 实现 Policy Enforcer。
- 实现本地签名 Policy Snapshot。
- 接入 DSH Approval。
- 实现 Audit Spool 和批量上传。
- 增加紧急 Capability Revocation。

验收：

- `deny` 永远优先。
- Jira 更新请求审批。
- Jira 删除按企业策略拒绝。
- 审批不可用时 fail closed。
- 审计中无 Secret 明文。

### 阶段 6：安装、更新与发布，2～4 周

任务：

- Artifact Cache 和签名下载。
- DSH Plugin Manager 安装适配。
- Windows 代码签名和安装器。
- Nova 更新源。
- 强制升级策略。
- 回滚与恢复验收。

验收：

- 干净 Windows 机器无需 Node/pnpm 即可运行。
- 更新包同时更新 Electron、DSH 和 Nova Bundle。
- 更新失败保留旧版本。
- 第三方插件导致启动失败时可恢复。

## 19. 第一条纵向业务切片

不要一开始同时实现七个角色。第一条切片固定为：

```text
角色：前端工程师
Workspace：一个本地 Vue 项目
Skill：Vue Best Practices
MCP：Wiki Search、Jira Readonly
本地工具：文件读写、搜索、PowerShell/Bash
权限：workspace-write + ask
模型：DeepSeek 默认编码模型
```

操作流程：

```text
1. 用户登录 Nova
2. 添加本地项目
3. 选择“前端工程师”
4. Nova 从 Hub 获取 RoleLock
5. Desktop 校验并生成 Preset
6. 新建 Session
7. Agent 搜索 Wiki
8. Agent 查询 Jira
9. Agent 修改本地代码
10. 写操作按 Permission Preset 请求确认
11. 全流程生成脱敏审计
```

该切片完成后，再扩展后端、全栈、产品、测试、设计和架构师。

## 20. 测试方案

### 20.1 Nova Harness

- Role 继承和覆盖。
- 依赖解析和冲突。
- RoleLock 确定性 checksum。
- 签名校验。
- Permission 合并优先级。
- Secret 脱敏。
- Artifact 路径穿越和压缩炸弹。

### 20.2 DSH Nova Packages

- Bundle Patch 组合结果。
- Role Compiler Golden Test。
- Preset mount / dispose。
- Skill Provider 分层和缓存。
- MCP Credential 更新与重连。
- Policy `allow/deny/requireApproval`。
- UI Slot 注册和释放。
- Remote API 重连。

### 20.3 Desktop

- Nova Home 隔离。
- Desktop Profile 首次初始化。
- 单实例。
- Host 启动失败恢复。
- 第三方 Bundle 禁用恢复。
- 签名 Runtime 清单。
- Windows 安装、覆盖升级和回滚。
- 强制更新。

### 20.4 端到端

```text
Workspace
→ Role Resolve
→ RoleLock
→ Preset
→ Session
→ Skill/MCP Tool Call
→ Policy
→ Approval
→ Audit
```

每个用户可见改动都需要更新 DSH Web Snapshot 或 Desktop 对应测试；不能只用单元测试替代产品行为验证。

## 21. 发布和兼容性

版本策略：

```text
Nova Desktop 1.0.0
├─ Electron 44.x
├─ DSH 0.2.0-rc.2（候选基线，验收通过后冻结）
├─ DSH commit 639ed015...
├─ Nova Bundle 1.0.0
└─ Nova Contract harness.nova/v2
```

每次升级 DSH 必须执行：

1. 合并上游到临时升级分支。
2. 检查 Desktop Profile、Agent Preset、MCP、Skill、Approval 接口变化。
3. 运行 Role Compiler Golden Diff。
4. 运行完整 Nova 纵向 E2E。
5. 生成兼容性报告。
6. 发布 Canary Desktop。
7. 灰度到内部研发用户。
8. 再发布正式版本。

Hub 返回 Capability 时必须同时检查：

```text
Nova Desktop version
DSH version
Capability runtime compatibility
Manifest schema version
```

## 22. 明确不做的事项

- 不重写 DeepSeek Harness Agent Loop。
- 不把 Claude Code 作为 Nova 主 Runtime。
- 不把 `cc-switch` 放进主模型链路。
- 不把 Vue Hub Admin 嵌入 Desktop。
- 不在 Electron 内运行 PostgreSQL。
- 不让普通用户直接安装任意 Host Plugin。
- 不把 Secret 写入 Role、Preset、YAML、Session 或日志。
- 不在已开始的 Session 中直接替换 Role。
- 不让 Nova Installer 和 DSH Plugin Manager 同时拥有 Profile `node_modules`。
- 不直接从一个仓库相对引用另一个仓库的源码。

## 23. 推荐实施提交顺序

建议按以下独立提交推进：

1. `chore(desktop): pin nova upstream baseline`
2. `feat(desktop): isolate nova home and product identity`
3. `feat(bundle): add nova desktop bundle`
4. `feat(ui): add nova brand slots`
5. `feat(contracts): add role lock and dsh bindings`
6. `feat(role): compile role locks to agent presets`
7. `feat(ui): add role selection`
8. `feat(hub): add desktop hub sdk and cache`
9. `feat(skill): add nova hub skill provider`
10. `feat(ui): add ai hub panel`
11. `feat(mcp): add credential-backed mcp binding`
12. `feat(policy): enforce tool permissions`
13. `feat(audit): add encrypted audit spool`
14. `feat(artifact): delegate profile installs to dsh plugin manager`
15. `build(desktop): package and sign nova runtime`

每个提交应能独立通过相关构建和测试，避免把品牌、Runtime、Hub、权限和发布一次性混成一个不可审查的大改动。

## 24. 完成定义

Nova Desktop 1.0 可以宣布完成，必须同时满足：

- 用户只通过 Nova Desktop 完成全部日常操作。
- 能添加 Workspace 并创建 Session。
- 新建 Session 前可选 Role。
- Role 能确定性加载 MCP、Skill 和工具。
- AI Hub 可以搜索、查看、添加和移除能力。
- 凭据不以明文落盘或进入会话。
- 工具调用受到本地强制权限控制。
- 高风险操作可审批，拒绝和不可用时 fail closed。
- Session 重启后仍绑定原 RoleLock。
- Hub 不可用时已缓存的低风险能力仍可按策略使用。
- 能力制品经过版本、摘要和签名校验。
- Desktop 更新是 Electron、DSH、Nova Bundle 的同版本签名单元。
- Windows 安装、升级、回滚和致命启动恢复通过验收。
- 上游 DSH 更新具备固定的兼容性检查流程。

## 25. 最终落地形态

```text
Nova Desktop
├─ DeepSeek Harness 提供 Agent Runtime
├─ Nova Bundle 注入企业能力
├─ Nova Role 编译为 Agent Preset
├─ Nova Hub 提供可搜索的能力目录
├─ Nova Policy 在本地强制执行权限
├─ Nova Credential Provider 管理企业认证
└─ Nova Electron 壳提供唯一产品入口
```

该方案最大化复用 DeepSeek Harness 已经完成的 Desktop、Agent、Session、MCP、Skill、Plugin、Sandbox 和更新能力，同时保留当前 Nova Harness 在 Catalog、Role、Installer、Secret 和企业治理上的已有投入。Nova 的核心工作集中在“组合、治理和体验”，不复制上游 Agent 基础设施。

## 26. 官方与社区版本选型决策

### 26.1 调研时间与结论

本节结论基于 2026-10-05 可见的官方仓库、官方 npm 发布状态，以及主要社区桌面发行版和社区 Web 插件生态。

最终决策：

> **Nova 的 Runtime/Core 只以 `deepseek-ai/deepseek-harness` 官方版本为上游；Nova Desktop 和 Nova Enterprise Layer 由 Nova 自己持有。社区版本不作为二级核心上游，只作为产品能力样板、兼容性经验和经过审计的可选组件来源。**

推荐组合：

```text
deepseek-ai/deepseek-harness（官方、精确锁版）
├─ Agent Loop / Session / Tool / Skill / MCP / Sandbox / Approval
├─ 官方 Web App / SDK / Desktop public boundary
└─ 官方协议、Profile、Bundle 和持久化格式
                  ↓
Nova-owned Desktop Distribution
├─ Nova Desktop Host / 品牌 / 安装器 / 更新器
├─ Nova Bundle / Role / Hub / Capability Provider
├─ Nova Credential / Policy / Audit / Enterprise Update
├─ Runtime Support Matrix / 回滚 / 安全模式
└─ 经审计后引入的社区组件
                  ↓
社区项目（参考或可选依赖，不成为产品基座）
├─ ningbainb/deepseek-harness-desktop
├─ @linxin666/dsh-web-all 及其可拆分插件
├─ oh-my-dsh
└─ 其他独立 DSH 插件
```

### 26.2 官方版本现状

官方仓库：<https://github.com/deepseek-ai/deepseek-harness>

截至本次复核：

- 官方仓库采用 MIT License。
- 官方明确采用 `Everything is a Plugin` 和 Cordis 组合架构。
- 官方源码已经包含 `apps/desktop`、Desktop 构建与打包脚本，不只是 CLI/Web Runtime。
- 官方明确仍处于 Developer Preview，并声明会发生破坏性兼容变更。
- 官方当前不接收外部 Pull Request，鼓励通过插件和独立生态扩展。
- 官方 npm 的 `latest` / `next` 为 `0.2.0-rc.2`；源码 `master` 已进入 `0.2.1-alpha.1`。
- 官方 `dsh-v0.2.0-rc.2` 对应提交为 `639ed015397290b3745d163aafe02ffee4aa3f84`。

参考：

- [官方 README](https://github.com/deepseek-ai/deepseek-harness#readme)
- [官方 CONTRIBUTING](https://github.com/deepseek-ai/deepseek-harness/blob/master/CONTRIBUTING.md)
- [官方 package.json](https://github.com/deepseek-ai/deepseek-harness/blob/master/package.json)
- [官方 Releases](https://github.com/deepseek-ai/deepseek-harness/releases)
- [@deepseek-ai/dsh npm 版本](https://www.npmjs.com/package/@deepseek-ai/dsh?activeTab=versions)

对 Nova 的含义：

1. 官方 Runtime 是协议和生态事实标准，应跟随它而不是让社区发行版替 Nova 定义核心接口。
2. 不能跟踪 `master` 或使用宽泛的 `latest`，必须锁定 tag、commit、npm integrity 和完整依赖图。
3. Developer Preview 阶段不能假设小版本兼容；每次升级都按一次 Runtime 迁移项目处理。
4. 因官方暂不接收外部 PR，Nova 必须把差异控制在 Bundle、Plugin、Provider、Preset、公开 SDK 和 Desktop Contract 边界；少量不得不保留的核心补丁进入独立 Patch Registry。

### 26.3 功能最完整的社区桌面版

主要候选：<https://github.com/ningbainb/deepseek-harness-desktop>

该项目当前的价值很高，但它的真实定位需要说清楚：

- 它是社区维护的跨平台桌面发行版，不是另一个 Agent Core。
- `5.0.0` 精确使用官方 npm Runtime `0.2.0-rc.2`。
- Web 能力主要组合自官方 `dsh-base`、`dsh-web-app`、社区 `dsh-web-all@0.4.4` 和桌面侧适配。
- 官方 Web 协议、数据路径和工具继续由官方 DSH 实现；社区项目负责 Desktop Host、生命周期、原生能力、插件事务和产品增强。
- 已经具备任务看板、定时任务、Git Graph、Worktree、文件预览、模型协作、Skill Center、插件市场、SSH/SFTP、远程访问、主题、桌宠、升级和回滚等丰富能力。
- 它形成了值得借鉴的 Runtime Support Matrix、候选版本验证、事务式安装、备份恢复、插件兼容诊断和公开 Desktop Contract。
- 采用 BSD-3-Clause；发行包当前未签名，macOS 未公证，macOS/Linux 仍标为 Preview。
- 项目主要由仓库所有者维护并接受社区贡献；这是可用性很强的社区产品，但不能替代 Nova 自己对企业交付、SLA、安全审计和供应链负责。

参考：

- [社区 Desktop README](https://github.com/ningbainb/deepseek-harness-desktop/blob/main/README.en.md)
- [社区 Desktop 架构](https://github.com/ningbainb/deepseek-harness-desktop/blob/main/docs/desktop.md)
- [Runtime 支持策略](https://github.com/ningbainb/deepseek-harness-desktop/blob/main/docs/runtime-support-policy.md)
- [兼容策略](https://github.com/ningbainb/deepseek-harness-desktop/blob/main/docs/compatibility-policy.md)
- [Desktop 5.0.0 Release](https://github.com/ningbainb/deepseek-harness-desktop/releases/tag/desktop-v5.0.0)

### 26.4 社区 Web/插件生态

`dsh-web` / `@linxin666/dsh-web-all` 是目前社区增强 UI 的重要来源：

<https://github.com/zhu1090093659/dsh-web>

其模块化插件提供任务看板、远程控制、SSH、用量统计、Git/Worktree、会话归档、模型能力声明、主题和插件市场等功能。它可以整体安装，也可以拆分安装单项插件。

Nova 不应在 1.0 默认整体引入 `dsh-web-all`，原因是：

- Nova 面向企业用户，只希望暴露 Workspace、Role、AI Hub、聊天/任务四个主概念。
- 整包会同时引入远程访问、SSH、主题、桌宠、公共市场等不一定属于 Nova 1.0 的功能和攻击面。
- 社区 UI 的信息架构和品牌并不等于 Nova 的产品体验。
- 社区包升级会让 Nova 同时跟随官方 DSH 和社区 Bundle 两条破坏性变更链。

正确方式是建立社区组件准入流程，按插件而不是按整包选择：

```text
发现候选组件
→ License / SBOM / 恶意代码和网络行为审计
→ API 与 DSH 目标版本兼容性验证
→ 权限、凭据、遥测和远程访问审查
→ 隔离 Profile 验证
→ Nova UI/Role/Policy 适配
→ 内网制品重打包、签名、上架 Nova Hub
```

### 26.5 其他社区形态及启示

| 项目形态 | 代表项目 | 对 Nova 的价值 | 是否作为基座 |
|---|---|---|---|
| 完整桌面发行版 | `ningbainb/deepseek-harness-desktop` | 功能和升级治理参考价值最高 | 否 |
| 模块化 Web 插件集 | `zhu1090093659/dsh-web` | 可按需审计和吸收单项 UI 能力 | 否，作为可选能力来源 |
| 保守 Desktop Wrapper | `qufei1993/dsh-desktop` | 证明桌面壳可以只负责官方 Runtime 生命周期 | 否，能力不足 |
| Overlay/Distribution | `amplifthq/oh-my-dsh` | 精确锁定上游、Bundle 组合、canary 验证的架构值得借鉴 | 否，且无原生 Windows 发行 |

社区项目共同说明了一件事：长期维护成本最低的方式不是长期修改 Agent Loop，而是把官方 Runtime 当作不可变依赖，在外层通过 Bundle、SDK、Profile 和 Desktop Host 组合产品。

### 26.6 选型对比

| 维度 | 官方仓库直接作为 Core 上游 | 社区 Desktop 作为完整基座 | 官方 Runtime + Nova 自有 Desktop |
|---|---|---|---|
| 核心协议权威性 | 最强 | 间接跟随官方 | 最强 |
| 开箱即用功能 | 中等 | 最强 | 前期中等、按 Nova 需求增长 |
| 上游合并复杂度 | 可控，但官方变化快 | 同时跟随官方和社区两条链 | 最可控 |
| 企业权限与审计 | 需要 Nova 实现 | 需要大范围改造 | 最适合 Nova 自定义 |
| 供应链可控性 | 高 | 依赖较多、审计面大 | 最高，可使用内网镜像和签名 |
| 产品信息架构 | 需要 Nova 定制 | 社区功能导向，概念较多 | 完全按 Nova 四概念设计 |
| 安全攻击面 | 可按需裁剪 | SSH、远程、市场等默认面更大 | 可按企业策略最小化 |
| 社区创新吸收 | 需要自行挑选 | 自动获得较多 | 通过准入流程选择性吸收 |
| 长期推荐度 | 适合作为 Runtime 上游 | 适合参考和个人用户发行 | **Nova 最佳方案** |

### 26.7 为什么不直接 Fork 社区 Desktop

直接 Fork 社区 Desktop 看起来能立刻获得更多功能，但会带来以下长期问题：

1. Nova 要同时处理官方 Runtime 变化、社区 Desktop 变化、`dsh-web-all` 变化和 Nova 企业层变化。
2. 社区版的功能优先级面向广泛个人用户，Nova 则面向企业权限、内网 Hub、Role 和审计，两者产品主线不同。
3. 社区版包含 Nova 1.0 不需要的远程访问、SSH、公共市场、遥测和娱乐化 UI，移除这些能力并持续跟随上游并不比按需引入更便宜。
4. 未来出现安全问题时，Nova 仍需独立承担修复和交付责任，不能把企业 SLA 建立在社区发布节奏上。
5. 社区项目本身已经选择“官方 npm Runtime + 外层 Desktop”的方向，反而证明 Nova 也应该拥有自己的外层，而不是再 Fork 它的外层。

### 26.8 Nova 的仓库与上游模型

推荐保持两条清晰代码线，而不是把两个项目长期揉成一个仓库：

```text
nova-dsh-upstream-mirror（只读镜像/升级工作区）
├─ origin: deepseek-ai/deepseek-harness
├─ 只保留官方 tag 和 Nova 必需的小型补丁
├─ 禁止开发 Nova 产品功能
└─ 负责生成可审计的 Runtime 制品

nova-harness（Nova 产品主仓库）
├─ apps/nova-desktop
├─ packages/nova-bundle
├─ packages/nova-role
├─ packages/nova-hub-client
├─ packages/nova-policy
├─ packages/nova-credentials
└─ packages/nova-audit
```

依赖方式：

- 首选依赖官方发布包，并把包同步到内网 npm，锁定版本和 integrity。
- 官方 Desktop/Web 只在公开扩展点不足时从源码构建。
- 禁止使用跨仓库相对路径引用。
- Nova Runtime 制品记录官方 tag、commit、lockfile digest、每个包的 integrity 和 Nova patch 列表。
- 每个 Nova Desktop 版本只能对应一个经过验证的 DSH Runtime Graph。

### 26.9 当前版本基线调整

本地 `E:\ai\deepseek-harness` 仍是 `0.1.6-alpha.2`。该版本可以保留为历史对照和已有内网修改的提取来源，但不建议继续作为 Nova 1.0 主开发基线。

建议把目标候选升级到：

```text
tag: dsh-v0.2.0-rc.2
commit: 639ed015397290b3745d163aafe02ffee4aa3f84
npm: @deepseek-ai/dsh@0.2.0-rc.2
```

选择 `0.2.0-rc.2` 而不是 `master/0.2.1-alpha.1` 的原因：

- 它是当前 npm `latest` / `next` 的精确版本。
- 社区 Desktop 5.0.0 已经完成一次跨平台适配和较大规模回归，可作为外部兼容性证据。
- `0.2.0` 已经发生设置服务、Profile、Session 等代际变化；越晚从 `0.1.6` 迁移，Nova 自身代码返工越多。
- `0.2.1-alpha.1` 是下一条 alpha 线，不适合作为企业产品冻结基线。

但 `0.2.0-rc.2` 仍然是 RC，且官方明确处于 Developer Preview，因此这里只把它定义成“Nova 候选基线”，不能未经验证直接进入正式发布。

### 26.10 从 0.1.6 迁移到 0.2.0 的门禁

先建立升级分支，不直接覆盖当前内网版本：

```text
codex/dsh-0.2.0-baseline
```

迁移步骤：

1. 冻结并备份当前 `0.1.6-alpha.2` 内网提交、Profile、Session 和凭据引用。
2. 把内网改动分类为：可删除的品牌改动、应迁到 Nova Plugin/Bundle 的产品能力、必须保留的 Core Patch、环境配置。
3. 在干净的官方 `dsh-v0.2.0-rc.2` 上先跑官方 build/test，不先合并 Nova 改动。
4. 验证官方 npm 完整依赖闭包，并同步到内网 npm；禁止运行时回退公网下载。
5. 单独验证 `settings.yaml` 到 Profile `cordis.patch.yml` 的迁移，生成迁移报告且保留原始文件。
6. 验证旧 Session 恢复、RoleLock 绑定、模型 Provider、Credential 引用和 MCP 配置。
7. 验证 Windows Sandbox、Workspace 边界、删除/移动、PowerShell、Git 和子进程权限。
8. 验证第三方 Plugin/Skill/MCP 的 peer 版本和启动失败行为。
9. 增加 Safe Mode：启动失败时临时禁用非官方/非 Nova 插件，不删除用户数据。
10. 通过 Nova 纵向切片 E2E 后，才把该 tag 写入正式 `integration-lock`。

必须增加的 Release Gate：

```text
official source build
→ npm closure/integrity
→ runtime contract
→ profile/settings migration
→ session migration
→ credential/MCP
→ workspace sandbox
→ plugin quarantine/safe mode
→ Nova Role/Hub/Policy/Audit E2E
→ packaged Windows fresh install
→ 0.1.6 overlay upgrade
→ rollback
```

若其中任一阻断项失败，则保持当前版本用于开发对照，并等待官方后续 RC 或在 Patch Registry 中维护范围最小、带移除条件的临时补丁；不能静默放宽权限或跳过迁移校验。

### 26.11 可从社区版优先吸收的工程能力

第一批建议借鉴设计、重新实现或在审计后复用：

1. Runtime Support Matrix：精确记录 Runtime、Desktop、Node、包摘要和兼容状态。
2. Transactional Plugin Install：隔离 staging、校验、原子切换、失败回滚。
3. Safe Plugin Boundary：可选插件失败不拖垮 Runtime，保留诊断和恢复入口。
4. Upgrade/Rollback：升级前备份 Profile 和用户数据，升级失败恢复旧制品。
5. Desktop Contract：只暴露有版本的能力接口，不把 Electron IPC 和 Secret 暴露给 Web Plugin。
6. Compatibility Known Issues：按 Runtime + Plugin + Platform 精确匹配，不永久误伤其他版本。
7. Candidate Canary：定期验证下一个官方版本，但不自动修改正式锁定版本。

第二批可按产品优先级评估：

- Task Board 与后台任务。
- Git Graph 和 Worktree UI。
- 会话搜索、归档和恢复。
- 文件交付与 Office/PDF 预览。
- 用量和配额看板。

Nova 1.0 默认不引入：

- 公网插件市场直连。
- 未经过企业策略的移动远程控制。
- SSH/SFTP/集群执行。
- 匿名遥测。
- 主题市场、动态桌宠等非核心体验。

这些能力不是永远不做，而是必须先进入 Nova Hub 的签名制品、权限策略和审计体系后再开放。

### 26.12 最终一句话决策

> **以官方 DeepSeek Harness `0.2.0-rc.2` 作为当前待验收 Runtime 候选，不基于社区 Desktop 做长期 Fork；Nova 自己实现并持有桌面发行层和企业层，同时系统性吸收社区版已经验证过的升级、回滚、插件兼容和工作台能力。**
