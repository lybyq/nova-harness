<script setup lang="ts">
import { RefreshRight } from '@element-plus/icons-vue';
import { computed, onMounted, shallowRef } from 'vue';
import { ElMessage } from 'element-plus';
import { useRouter } from 'vue-router';
import CapabilityDetailDrawer from '../components/CapabilityDetailDrawer.vue';
import FeaturedCapabilities from '../components/FeaturedCapabilities.vue';
import HubSearchHero from '../components/HubSearchHero.vue';
import MetricStrip from '../components/MetricStrip.vue';
import { useHubApi } from '../composables/useHubApi';
import type { Capability, CatalogPage, SyncRun } from '../types';

const router = useRouter();
const { request } = useHubApi();
const health = shallowRef<'checking' | 'healthy' | 'unavailable'>('checking');
const catalog = shallowRef<CatalogPage>();
const runs = shallowRef<SyncRun[]>([]);
const loading = shallowRef(false);
const selected = shallowRef<Capability>();
const drawerOpen = shallowRef(false);

const metrics = computed(() => {
  const items = catalog.value?.data ?? [];
  return [
    { label: '目录能力', value: catalog.value?.total ?? '—', detail: '跨 GitLab 与 npm 聚合' },
    {
      label: '已审核',
      value: items.filter((item) => item.status === 'active').length,
      detail: '可直接进入角色组合',
    },
    {
      label: '能力类型',
      value: new Set(items.map((item) => item.type)).size,
      detail: 'MCP / Skill / Plugin 等',
    },
    { label: '同步成功率', value: successRate(runs.value), detail: '最近 100 次来源任务' },
  ];
});

const featured = computed(() =>
  (catalog.value?.data ?? [])
    .filter((item) => item.status === 'active')
    .sort((left, right) => Number(hasRecommended(right)) - Number(hasRecommended(left)))
    .slice(0, 6),
);

async function load(): Promise<void> {
  loading.value = true;
  try {
    await request('/health');
    health.value = 'healthy';
    [catalog.value, runs.value] = await Promise.all([
      request<CatalogPage>('/catalog?pageSize=100'),
      request<SyncRun[]>('/sync/runs'),
    ]);
  } catch (error) {
    health.value = 'unavailable';
    ElMessage.error(error instanceof Error ? error.message : '无法读取 Hub 状态');
  } finally {
    loading.value = false;
  }
}

/** 把首页搜索和类型快捷入口都映射到可分享的目录 URL。 */
async function browse(query: string, type?: string): Promise<void> {
  await router.push({
    path: '/catalog',
    query: { ...(query ? { q: query } : {}), ...(type ? { type } : {}) },
  });
}

function selectCapability(capability: Capability): void {
  selected.value = capability;
  drawerOpen.value = true;
}

function hasRecommended(capability: Capability): boolean {
  return capability.versions.some((version) => version.recommended);
}

function successRate(items: SyncRun[]): string {
  if (!items.length) return '—';
  const succeeded = items.filter((item) => item.status === 'SUCCEEDED').length;
  return `${Math.round((succeeded / items.length) * 100)}%`;
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

onMounted(load);
</script>

<template>
  <div class="page dashboard-page">
    <HubSearchHero
      :total="catalog?.total ?? '—'"
      :online="health === 'healthy'"
      @search="browse($event)"
      @browse-type="browse('', $event)"
    />

    <MetricStrip :items="metrics" />
    <FeaturedCapabilities :items="featured" @select="selectCapability" />

    <section class="dashboard-lower-grid">
      <article class="panel activity-panel">
        <div class="section-heading section-heading--compact">
          <div>
            <span class="section-kicker">SOURCE ACTIVITY</span>
            <h2>最近同步</h2>
          </div>
          <el-button text :loading="loading" @click="load"
            ><el-icon><RefreshRight /></el-icon>刷新</el-button
          >
        </div>
        <div v-if="runs.length" class="activity-list">
          <div v-for="run in runs.slice(0, 6)" :key="run.id" class="activity-row">
            <span :class="['activity-icon', `activity-icon--${run.status.toLowerCase()}`]" />
            <div>
              <strong>{{ run.sourceId }}</strong
              ><small>{{ formatTime(run.startedAt) }}</small>
            </div>
            <span class="activity-summary">{{ run.discovered }} 发现 · {{ run.updated }} 更新</span>
            <code>{{ run.status }}</code>
          </div>
        </div>
        <el-empty v-else description="尚无同步记录" :image-size="72" />
      </article>

      <article class="quickstart-card">
        <span class="section-kicker">QUICK START</span>
        <h2>从角色开始，而不是逐个安装。</h2>
        <p>一条命令解析前端角色所需能力、生成 Plan，并安全编译到 Claude Code。</p>
        <pre><code><span>$</span> nova init --role frontend</code></pre>
        <RouterLink to="/roles">查看 7 个内置角色 →</RouterLink>
      </article>
    </section>

    <CapabilityDetailDrawer v-model="drawerOpen" :capability="selected" />
  </div>
</template>
