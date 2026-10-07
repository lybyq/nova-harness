# Nova Harness 1.0 仓库目录树

以下列出交付源码与制品；`node_modules/`、`dist/`、`coverage/` 等可再生目录不列入。

```text
nova-harness/
├─ apps/
│  ├─ cli/
│  │  ├─ src/
│  │  │  ├─ commands/ (capabilities, doctor, local-state, operations, project, roles, secrets + tests)
│  │  │  ├─ config/ (environment-secrets, hub-registry, load-deployment, local-catalog, runtime-preference)
│  │  │  ├─ hub/hub-client.ts
│  │  │  ├─ i18n/messages.ts
│  │  │  ├─ interactive/home.ts
│  │  │  ├─ presenter/output.ts
│  │  │  └─ main.ts
│  │  ├─ package.json
│  │  └─ tsconfig.json
│  ├─ hub-api/
│  │  ├─ src/
│  │  │  ├─ admin/ (controller, module, service)
│  │  │  ├─ auth/ (guard, public decorator)
│  │  │  ├─ catalog/ (controller, module, service, query DTO)
│  │  │  ├─ configuration/ (module, deployment service, environment Secret resolver)
│  │  │  ├─ health/health.controller.ts
│  │  │  ├─ manifests/ (controller, module)
│  │  │  ├─ platform/harness-exception.filter.ts
│  │  │  ├─ prisma/ (module, service)
│  │  │  ├─ resolve/ (controller, module, service)
│  │  │  ├─ roles/ (controller, module, service)
│  │  │  ├─ runtime/ (controller, module)
│  │  │  ├─ sync/ (controller, module, service)
│  │  │  ├─ app.module.ts
│  │  │  └─ main.ts
│  │  ├─ package.json
│  │  └─ tsconfig.json
│  ├─ hub-admin/
│  │  ├─ src/
│  │  │  ├─ components/ (AppShell, CapabilityDetailDrawer, CapabilityList, CapabilityTable,
│  │  │  │  CatalogFilters, FeaturedCapabilities, HubSearchHero, MetricStrip, PageHeading)
│  │  │  ├─ composables/useHubApi.ts
│  │  │  ├─ styles/index.scss
│  │  │  ├─ views/ (Audit, Catalog, Dashboard, Manifests, Roles, Sources)
│  │  │  ├─ App.vue
│  │  │  ├─ main.ts
│  │  │  ├─ router.ts
│  │  │  └─ types.ts
│  │  ├─ index.html
│  │  ├─ package.json
│  │  ├─ tsconfig.json
│  │  └─ vite.config.ts
│  └─ mock-server/
│     ├─ src/server.ts
│     ├─ package.json
│     └─ tsconfig.json
├─ packages/
│  ├─ contracts/src/ (capability, common, deployment, profile, project, state, index + tests)
│  ├─ core/src/ (planner, profile-merge, resolver, runtime, index + tests)
│  ├─ installer/src/ (apply-engine, artifact-installer, layout, lock, state-store, index + tests)
│  ├─ runtime-claude/src/ (claude-runtime, index + tests)
│  ├─ secrets/src/ (encrypted-file-store, factory, secret-store, windows-dpapi-store, index + tests)
│  ├─ shared/src/ (checksum, errors, redactor, result, index + tests)
│  ├─ source-gitlab/src/ (gitlab-source, index + tests)
│  └─ source-npm/src/ (npm-source, index + tests)
│     （每个包均包含 package.json 与 tsconfig.json）
├─ prisma/
│  ├─ migrations/20260807193000_init/migration.sql
│  ├─ migrations/migration_lock.toml
│  ├─ schema.prisma
│  └─ seed.ts
├─ manifests/
│  ├─ deployments/ (internal.example, mock-e2e, mock-host, public-smoke)
│  └─ roles/ (architect, backend, base-developer, designer, frontend, fullstack, product, qa)
├─ tests/
│  ├─ integration/mock-sources.test.ts
│  └─ public/sources.public.test.ts
├─ docs/
│  ├─ acceptance-report.md
│  ├─ architecture.md
│  ├─ architecture-decisions.md
│  ├─ capability-manifest.md
│  ├─ cli-usage.md
│  ├─ completion-matrix.md
│  ├─ hub-deployment.md
│  ├─ implementation-plan.md
│  ├─ operations.md
│  ├─ repository-tree.md
│  ├─ role-authoring.md
│  ├─ security.md
│  └─ troubleshooting.md
├─ artifacts/
│  ├─ nova-cbb-harness-cli-1.0.0.tgz
│  ├─ nova-cbb-harness-contracts-1.0.0.tgz
│  ├─ nova-cbb-harness-core-1.0.0.tgz
│  ├─ nova-cbb-harness-installer-1.0.0.tgz
│  ├─ nova-cbb-harness-secrets-1.0.0.tgz
│  ├─ nova-cbb-harness-shared-1.0.0.tgz
│  ├─ nova-cbb-runtime-claude-code-1.0.0.tgz
│  ├─ nova-cbb-source-gitlab-1.0.0.tgz
│  ├─ nova-cbb-source-npm-1.0.0.tgz
│  └─ SHA256SUMS.txt
├─ scripts/release-check.mjs
├─ .dockerignore
├─ .env.example
├─ .gitignore
├─ .npmrc
├─ .prettierignore
├─ .prettierrc.json
├─ Dockerfile
├─ docker-compose.yml
├─ eslint.config.js
├─ package.json
├─ pnpm-lock.yaml
├─ pnpm-workspace.yaml
├─ README.md
├─ tsconfig.base.json
├─ vitest.config.ts
└─ vitest.public.config.ts
```
