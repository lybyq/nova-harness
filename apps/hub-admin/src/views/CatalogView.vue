<script setup lang="ts">
import { ArrowRight, Connection, MagicStick, Search } from '@element-plus/icons-vue';
import { computed, reactive, shallowRef, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { useRoute, useRouter } from 'vue-router';
import CapabilityList from '../components/CapabilityList.vue';
import CatalogFilters from '../components/CatalogFilters.vue';
import { useHubApi } from '../composables/useHubApi';
import type { Capability, CatalogPage } from '../types';

const route = useRoute();
const router = useRouter();
const { request } = useHubApi();
const filters = reactive({ q: '', type: '', status: '', tag: '' });
const page = shallowRef(1);
const pageSize = shallowRef(24);
const total = shallowRef(0);
const rows = shallowRef<Capability[]>([]);
const loading = shallowRef(false);
const sortMode = shallowRef<'recommended' | 'updated'>('recommended');

const typeCounts = computed(() => countBy(rows.value, (item) => item.type));
const statusCounts = computed(() => countBy(rows.value, (item) => item.status));
const featuredRows = computed(() =>
  rows.value.filter((item) => item.status === 'active').slice(0, 4),
);
const popularTags = computed(() => {
  const tags = rows.value.flatMap((item) => [...(item.categories ?? []), ...(item.tags ?? [])]);
  return Object.entries(countValues(tags))
    .sort((left, right) => right[1] - left[1])
    .slice(0, 10)
    .map(([label, count]) => ({ label, count }));
});
const sortedRows = computed(() => {
  if (sortMode.value === 'updated') {
    return [...rows.value].sort(
      (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
    );
  }
  return [...rows.value].sort((left, right) => {
    const statusDelta = Number(right.status === 'active') - Number(left.status === 'active');
    return statusDelta || left.displayName.localeCompare(right.displayName, 'zh-CN');
  });
});
const hasFilters = computed(() =>
  Boolean(filters.q || filters.type || filters.status || filters.tag),
);

/** 读取目录分页，并把所有筛选条件显式转换为 Hub API 查询参数。 */
async function load(reset = false): Promise<void> {
  if (reset) page.value = 1;
  loading.value = true;
  try {
    const query = new URLSearchParams({
      page: String(page.value),
      pageSize: String(pageSize.value),
    });
    if (filters.q) query.set('q', filters.q);
    if (filters.type) query.set('type', filters.type);
    if (filters.status) query.set('status', filters.status);
    if (filters.tag) query.set('tag', filters.tag);
    const result = await request<CatalogPage>(`/catalog?${query}`);
    rows.value = result.data;
    total.value = result.total;
  } catch (error) {
    rows.value = [];
    total.value = 0;
    ElMessage.error(error instanceof Error ? error.message : '目录加载失败');
  } finally {
    loading.value = false;
  }
}

/** 把筛选器写回 URL，确保搜索、浏览器返回与复制链接的行为一致。 */
async function applyFilters(): Promise<void> {
  const query = {
    ...(filters.q ? { q: filters.q.trim() } : {}),
    ...(filters.type ? { type: filters.type } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.tag ? { tag: filters.tag } : {}),
  };
  const unchanged = JSON.stringify(query) === JSON.stringify(route.query);
  if (unchanged) await load(true);
  else await router.replace({ path: '/catalog', query });
}

/** 从标签横条切换业务分类；再次点击已选标签会恢复全部分类。 */
async function selectTag(tag: string): Promise<void> {
  filters.tag = filters.tag === tag ? '' : tag;
  await applyFilters();
}

/** 卡片点击后进入可分享、可直接刷新的独立能力详情路由。 */
async function openCapability(capability: Capability): Promise<void> {
  await router.push({ name: 'capability-detail', params: { id: capability.id } });
}

/** 切页时保留当前筛选条件，只重新请求目标页数据。 */
async function changePage(value: number): Promise<void> {
  page.value = value;
  await load();
}

/** 对一组能力按指定字段计数，供左侧筛选器显示当前结果概况。 */
function countBy(
  items: Capability[],
  selector: (item: Capability) => string,
): Record<string, number> {
  return countValues(items.map(selector));
}

/** 将字符串列表聚合为频次字典，并忽略空白标签。 */
function countValues(values: string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((result, value) => {
    const key = value.trim();
    if (key) result[key] = (result[key] ?? 0) + 1;
    return result;
  }, {});
}

watch(
  () => route.query,
  (query) => {
    filters.q = typeof query.q === 'string' ? query.q : '';
    filters.type = typeof query.type === 'string' ? query.type : '';
    filters.status = typeof query.status === 'string' ? query.status : '';
    filters.tag = typeof query.tag === 'string' ? query.tag : '';
    void load(true);
  },
  { immediate: true },
);
</script>

<template>
  <div class="marketplace-page">
    <section class="marketplace-hero">
      <div class="marketplace-hero__orbit marketplace-hero__orbit--one"><Connection /></div>
      <div class="marketplace-hero__orbit marketplace-hero__orbit--two"><MagicStick /></div>
      <div class="marketplace-hero__orbit marketplace-hero__orbit--three">N</div>
      <div class="marketplace-hero__content">
        <span class="marketplace-hot"><MagicStick /> 内网能力，统一发现与治理 <ArrowRight /></span>
        <h1>释放你的 Agent 潜能</h1>
        <p>发现经过组织治理的 Skills、MCP、Plugins 与 Agents</p>
        <form class="marketplace-search" role="search" @submit.prevent="applyFilters">
          <el-input
            v-model="filters.q"
            size="large"
            clearable
            placeholder="搜索能力名称、ID、描述或标签..."
          >
            <template #prefix
              ><el-icon><Search /></el-icon
            ></template>
          </el-input>
          <el-button native-type="submit" type="primary" size="large">搜索市场</el-button>
        </form>
      </div>
    </section>

    <div class="marketplace-content">
      <CatalogFilters
        v-model="filters"
        :type-counts="typeCounts"
        :status-counts="statusCounts"
        @search="applyFilters"
      />

      <main class="marketplace-results">
        <section v-if="!hasFilters && featuredRows.length" class="featured-market-section">
          <div class="market-section-heading">
            <div>
              <span>CURATED</span>
              <h2>精选能力</h2>
            </div>
            <p>管理员审核通过、适合优先采用的组织能力</p>
          </div>
          <CapabilityList :rows="featuredRows" :loading="loading" @select="openCapability" />
        </section>

        <section class="all-market-section">
          <div class="category-strip">
            <button :class="{ active: !filters.tag }" type="button" @click="selectTag('')">
              全部 <small>{{ total }}</small>
            </button>
            <button
              v-for="tag in popularTags"
              :key="tag.label"
              :class="{ active: filters.tag === tag.label }"
              type="button"
              @click="selectTag(tag.label)"
            >
              {{ tag.label }} <small>{{ tag.count }}</small>
            </button>
          </div>

          <div class="market-list-toolbar">
            <div>
              <h2>{{ filters.q ? `“${filters.q}” 的结果` : '全部能力' }}</h2>
              <span>共 {{ total }} 项可用能力</span>
            </div>
            <div class="market-sort" aria-label="列表排序">
              <button
                :class="{ active: sortMode === 'recommended' }"
                type="button"
                @click="sortMode = 'recommended'"
              >
                推荐优先
              </button>
              <button
                :class="{ active: sortMode === 'updated' }"
                type="button"
                @click="sortMode = 'updated'"
              >
                最近更新
              </button>
            </div>
          </div>

          <CapabilityList :rows="sortedRows" :loading="loading" @select="openCapability" />
          <el-pagination
            class="market-pagination"
            :current-page="page"
            :page-size="pageSize"
            layout="prev, pager, next"
            :total="total"
            @current-change="changePage"
          />
        </section>
      </main>
    </div>

    <section class="marketplace-cta">
      <div>
        <span>NOVA CREATOR</span>
        <h2>把团队经验沉淀成可复用能力</h2>
        <p>通过 GitLab 或 npm 发布，Hub 同步后即可在整个组织中发现和安装。</p>
      </div>
      <RouterLink to="/sources">配置能力来源 <ArrowRight /></RouterLink>
    </section>
  </div>
</template>
