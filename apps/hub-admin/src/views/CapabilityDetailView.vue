<script setup lang="ts">
import {
  ArrowLeft,
  Box,
  Check,
  CircleCheck,
  CollectionTag,
  Connection,
  CopyDocument,
  Document,
  EditPen,
  Lock,
  MagicStick,
  Monitor,
  Refresh,
  SetUp,
} from '@element-plus/icons-vue';
import { computed, shallowRef, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useRoute, useRouter } from 'vue-router';
import { useHubApi } from '../composables/useHubApi';
import type {
  Capability,
  CapabilityCompatibility,
  CapabilityDependencies,
  CapabilityVersion,
} from '../types';

const route = useRoute();
const router = useRouter();
const { request } = useHubApi();
const capability = shallowRef<Capability>();
const versions = shallowRef<CapabilityVersion[]>([]);
const dependencies = shallowRef<CapabilityDependencies[]>([]);
const compatibility = shallowRef<CapabilityCompatibility[]>([]);
const loading = shallowRef(false);
const activeTab = shallowRef('guide');
const copied = shallowRef(false);
const metadataEditor = shallowRef(false);
const metadataText = shallowRef('');
const compatibilityEditor = shallowRef(false);
const compatibilityVersion = shallowRef('');
const compatibilityText = shallowRef('{}');

const capabilityId = computed(() => String(route.params.id ?? ''));
const installCommand = computed(() => `nova add ${capabilityId.value} --yes`);
const recommendedVersion = computed(
  () => versions.value.find((version) => version.recommended) ?? versions.value[0],
);
const statusLabel = computed(() => {
  const labels: Record<string, string> = {
    active: '已审核',
    experimental: '实验性',
    'needs-review': '待审核',
    disabled: '已停用',
    deprecated: '已弃用',
  };
  return capability.value ? (labels[capability.value.status] ?? capability.value.status) : '';
});
const typeIcon = computed(() => {
  const icons = { skill: MagicStick, mcp: Connection, plugin: CollectionTag, agent: Monitor };
  return capability.value ? (icons[capability.value.type as keyof typeof icons] ?? Box) : Box;
});

/** 并行读取能力主体、版本、依赖与 Runtime 兼容性，组成完整详情页数据。 */
async function loadDetail(): Promise<void> {
  if (!capabilityId.value) return;
  loading.value = true;
  try {
    const encodedId = encodeURIComponent(capabilityId.value);
    const [detail, versionRows, dependencyRows, compatibilityRows] = await Promise.all([
      request<Capability>(`/capabilities/${encodedId}`),
      request<CapabilityVersion[]>(`/capabilities/${encodedId}/versions`),
      request<CapabilityDependencies[]>(`/capabilities/${encodedId}/dependencies`),
      request<CapabilityCompatibility[]>(`/capabilities/${encodedId}/compatibility`),
    ]);
    capability.value = detail;
    versions.value = versionRows;
    dependencies.value = dependencyRows;
    compatibility.value = compatibilityRows;
  } catch (error) {
    capability.value = undefined;
    ElMessage.error(error instanceof Error ? error.message : '能力详情加载失败');
  } finally {
    loading.value = false;
  }
}

/** 复制可直接执行的 Nova CLI 安装命令，并向用户提供明确反馈。 */
async function copyInstallCommand(): Promise<void> {
  await navigator.clipboard.writeText(installCommand.value);
  copied.value = true;
  ElMessage.success('安装命令已复制');
  window.setTimeout(() => (copied.value = false), 1600);
}

/** 打开元数据覆盖编辑器；来源事实仍会在后续同步时保留。 */
function editMetadata(): void {
  if (!capability.value) return;
  metadataText.value = JSON.stringify(
    {
      displayName: capability.value.displayName,
      description: capability.value.description,
      status: capability.value.status,
      riskLevel: capability.value.riskLevel,
    },
    null,
    2,
  );
  metadataEditor.value = true;
}

/** 保存管理员元数据覆盖并刷新详情，确保页面展示服务端最终有效值。 */
async function saveMetadata(): Promise<void> {
  await request(`/capabilities/${encodeURIComponent(capabilityId.value)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(JSON.parse(metadataText.value) as unknown),
  });
  metadataEditor.value = false;
  ElMessage.success('能力元数据覆盖已保存');
  await loadDetail();
}

/** 将指定版本设为唯一推荐版本，并重新读取版本治理状态。 */
async function recommend(version: string): Promise<void> {
  await request(
    `/capabilities/${encodeURIComponent(capabilityId.value)}/versions/${encodeURIComponent(version)}/recommend`,
    { method: 'POST' },
  );
  ElMessage.success(`已推荐 ${version}`);
  await loadDetail();
}

/** 软禁用指定版本；历史 Store、Revision 与审计记录仍然保留。 */
async function disable(version: string): Promise<void> {
  await ElMessageBox.confirm(`确认禁用版本 ${version}？`, '版本治理', { type: 'warning' });
  await request(
    `/capabilities/${encodeURIComponent(capabilityId.value)}/versions/${encodeURIComponent(version)}/disable`,
    { method: 'POST' },
  );
  ElMessage.success(`版本 ${version} 已禁用`);
  await loadDetail();
}

/** 打开指定版本的 Runtime Compatibility JSON 编辑器。 */
function editCompatibility(version: string): void {
  const current = compatibility.value.find((item) => item.version === version);
  compatibilityVersion.value = version;
  compatibilityText.value = JSON.stringify(current?.runtimeBindings ?? {}, null, 2);
  compatibilityEditor.value = true;
}

/** 保存 Runtime Compatibility，并刷新所有详情数据与管理员审计状态。 */
async function saveCompatibility(): Promise<void> {
  await request(
    `/capabilities/${encodeURIComponent(capabilityId.value)}/versions/${encodeURIComponent(compatibilityVersion.value)}/compatibility`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(JSON.parse(compatibilityText.value) as unknown),
    },
  );
  compatibilityEditor.value = false;
  ElMessage.success('Runtime Compatibility 已保存');
  await loadDetail();
}

/** 使用当前语言环境格式化更新时间；无效时间回退为原始值。 */
function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('zh-CN', { dateStyle: 'long' }).format(date);
}

/** 将未知结构安全格式化为便于审阅的 JSON，不执行或渲染其中的 HTML。 */
function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

watch(capabilityId, () => void loadDetail(), { immediate: true });
</script>

<template>
  <div v-loading="loading" class="capability-detail-page">
    <template v-if="capability">
      <div class="detail-breadcrumb">
        <button type="button" @click="router.push('/catalog')"><ArrowLeft /> 能力市场</button
        ><span>/</span><strong>{{ capability.displayName }}</strong>
      </div>

      <section class="detail-identity">
        <span :class="['detail-identity__icon', `detail-identity__icon--${capability.type}`]">
          <el-icon><component :is="typeIcon" /></el-icon>
        </span>
        <div class="detail-identity__copy">
          <div class="detail-identity__title">
            <h1>{{ capability.displayName }}</h1>
            <span :class="['catalog-status', `catalog-status--${capability.status}`]">{{
              statusLabel
            }}</span>
          </div>
          <div class="detail-byline">
            <span
              >来自 <strong>@{{ capability.sourceId }}</strong></span
            ><i /><span>更新于 {{ formatDate(capability.updatedAt) }}</span
            ><i /><code>{{ capability.id }}</code>
          </div>
          <p>{{ capability.description || '该能力尚未填写说明。' }}</p>
          <div class="detail-tag-row">
            <span class="type-chip">{{ capability.type }}</span
            ><span v-for="tag in capability.tags ?? []" :key="tag">{{ tag }}</span>
          </div>
        </div>
        <el-button class="edit-metadata-button" :icon="EditPen" plain @click="editMetadata"
          >编辑元数据</el-button
        >
      </section>

      <el-tabs v-model="activeTab" class="detail-tabs">
        <el-tab-pane name="guide"
          ><template #label><Document />指南</template></el-tab-pane
        >
        <el-tab-pane name="versions"
          ><template #label><Refresh />版本 {{ versions.length }}</template></el-tab-pane
        >
        <el-tab-pane name="dependencies"
          ><template #label><SetUp />依赖</template></el-tab-pane
        >
        <el-tab-pane name="compatibility"
          ><template #label><Monitor />兼容性</template></el-tab-pane
        >
      </el-tabs>

      <div class="detail-layout">
        <article class="detail-document">
          <template v-if="activeTab === 'guide'">
            <span class="detail-section-kicker">OVERVIEW</span>
            <h2>{{ capability.displayName }}</h2>
            <p class="detail-lead">{{ capability.description || '该能力尚未填写说明。' }}</p>
            <div class="detail-callout">
              <CircleCheck />
              <div>
                <strong>组织内可发现</strong>
                <p>
                  该能力已进入统一 Hub 目录，可通过 Nova CLI 在已配置的内网环境中解析、安装与审计。
                </p>
              </div>
            </div>
            <h3>使用方式</h3>
            <ol class="usage-steps">
              <li>
                <span>01</span>
                <div>
                  <strong>确认 Hub</strong>
                  <p>运行 <code>nova hub status</code> 检查当前组织 Hub 是否可达。</p>
                </div>
              </li>
              <li>
                <span>02</span>
                <div>
                  <strong>安装能力</strong>
                  <p>复制右侧命令，将推荐版本加入当前 Profile。</p>
                </div>
              </li>
              <li>
                <span>03</span>
                <div>
                  <strong>应用配置</strong>
                  <p>运行 <code>nova plan</code> 预览变更，再使用 <code>nova apply</code> 落地。</p>
                </div>
              </li>
            </ol>
            <h3>来源与可信边界</h3>
            <dl class="source-facts">
              <div>
                <dt>来源 ID</dt>
                <dd>{{ capability.sourceId }}</dd>
              </div>
              <div>
                <dt>来源定位符</dt>
                <dd>
                  <code>{{ capability.sourceLocator }}</code>
                </dd>
              </div>
              <div>
                <dt>风险等级</dt>
                <dd>{{ capability.riskLevel }}</dd>
              </div>
              <div>
                <dt>推荐版本</dt>
                <dd>{{ recommendedVersion?.version ?? '暂无' }}</dd>
              </div>
            </dl>
          </template>

          <template v-else-if="activeTab === 'versions'">
            <span class="detail-section-kicker">RELEASES</span>
            <h2>可用版本</h2>
            <p class="detail-lead">推荐、兼容性和禁用操作均会写入管理员治理层与审计记录。</p>
            <div class="version-list">
              <article v-for="version in versions" :key="version.version" class="version-row">
                <div>
                  <strong>{{ version.version }}</strong
                  ><el-tag v-if="version.recommended" type="success" size="small"
                    ><Check /> 推荐</el-tag
                  ><code>{{
                    version.commitSha?.slice(0, 12) ??
                    version.integrity?.slice(0, 18) ??
                    '无提交摘要'
                  }}</code>
                </div>
                <div>
                  <el-button
                    text
                    :disabled="version.recommended"
                    @click="recommend(version.version)"
                    >设为推荐</el-button
                  ><el-button text @click="editCompatibility(version.version)">编辑兼容性</el-button
                  ><el-button text type="danger" @click="disable(version.version)">禁用</el-button>
                </div>
              </article>
            </div>
          </template>

          <template v-else-if="activeTab === 'dependencies'">
            <span class="detail-section-kicker">DEPENDENCIES</span>
            <h2>依赖关系</h2>
            <p class="detail-lead">按版本展示来源清单中的直接依赖，供安装计划与离线准备核对。</p>
            <pre
              v-for="(item, index) in dependencies"
              :key="item.version ?? index"
              class="detail-json"
              >{{ formatJson(item) }}</pre>
            <el-empty v-if="dependencies.length === 0" description="此能力未声明依赖" />
          </template>

          <template v-else>
            <span class="detail-section-kicker">RUNTIME BINDINGS</span>
            <h2>Runtime 兼容性</h2>
            <p class="detail-lead">版本与 Runtime 的绑定信息用于安装前校验和配置生成。</p>
            <div class="compatibility-list">
              <article v-for="item in compatibility" :key="item.version">
                <header>
                  <strong>{{ item.version }}</strong
                  ><el-button text @click="editCompatibility(item.version)">编辑</el-button>
                </header>
                <pre>{{ formatJson(item.runtimeBindings) }}</pre>
              </article>
            </div>
            <el-empty v-if="compatibility.length === 0" description="暂无 Runtime 兼容性声明" />
          </template>
        </article>

        <aside class="install-panel">
          <div class="install-panel__heading">
            <span><Lock /> 内网可信安装</span><small>通过当前 Hub 解析</small>
          </div>
          <div class="install-version">
            <span>推荐版本</span><strong>{{ recommendedVersion?.version ?? '暂无' }}</strong>
          </div>
          <label>Nova CLI</label>
          <button class="install-command" type="button" @click="copyInstallCommand">
            <code>{{ installCommand }}</code
            ><el-icon><Check v-if="copied" /><CopyDocument v-else /></el-icon>
          </button>
          <p>命令只写入期望状态。执行 <code>nova plan</code> 可先检查实际变更。</p>
          <el-button
            type="primary"
            size="large"
            :icon="copied ? Check : CopyDocument"
            @click="copyInstallCommand"
            >{{ copied ? '已复制' : '复制安装命令' }}</el-button
          >
          <div class="install-facts">
            <span><CircleCheck /> {{ statusLabel }}</span
            ><span><Lock /> 风险等级 {{ capability.riskLevel }}</span
            ><span><Box /> {{ versions.length }} 个版本</span>
          </div>
        </aside>
      </div>
    </template>

    <el-empty v-else-if="!loading" class="detail-not-found" description="未找到该能力"
      ><el-button type="primary" @click="router.push('/catalog')">返回能力市场</el-button></el-empty
    >

    <el-dialog v-model="metadataEditor" title="能力元数据覆盖" width="min(620px, 92vw)">
      <p class="dialog-help">仅编辑管理员覆盖层；来源事实会继续由后续同步刷新。</p>
      <el-input v-model="metadataText" type="textarea" :rows="16" />
      <template #footer
        ><el-button @click="metadataEditor = false">取消</el-button
        ><el-button type="primary" @click="saveMetadata">保存</el-button></template
      >
    </el-dialog>
    <el-dialog v-model="compatibilityEditor" title="Runtime Compatibility" width="min(620px, 92vw)">
      <p class="dialog-help">以 Runtime ID 为键填写 compatibility 与 configuration。</p>
      <el-input v-model="compatibilityText" type="textarea" :rows="16" />
      <template #footer
        ><el-button @click="compatibilityEditor = false">取消</el-button
        ><el-button type="primary" @click="saveCompatibility">保存</el-button></template
      >
    </el-dialog>
  </div>
</template>
