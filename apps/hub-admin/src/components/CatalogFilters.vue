<script setup lang="ts">
interface Filters {
  q: string;
  type: string;
  status: string;
  tag: string;
}

interface FilterOption {
  value: string;
  label: string;
  count?: number;
}

const props = withDefaults(
  defineProps<{
    typeCounts?: Record<string, number>;
    statusCounts?: Record<string, number>;
  }>(),
  { typeCounts: () => ({}), statusCounts: () => ({}) },
);
const model = defineModel<Filters>({ required: true });
const emit = defineEmits<{ search: [] }>();

const typeOptions: FilterOption[] = [
  { value: 'skill', label: 'Skills' },
  { value: 'mcp', label: 'MCP 服务' },
  { value: 'plugin', label: 'Plugins' },
  { value: 'agent', label: 'Agents' },
  { value: 'hook', label: 'Hooks' },
  { value: 'policy', label: 'Policies' },
  { value: 'pack', label: '能力包' },
];
const statusOptions: FilterOption[] = [
  { value: 'active', label: '已审核' },
  { value: 'experimental', label: '实验性' },
  { value: 'needs-review', label: '待审核' },
  { value: 'disabled', label: '已停用' },
];

/** 单选式切换能力类型；重复点击当前项时恢复“全部”。 */
function selectType(value: string): void {
  model.value.type = model.value.type === value ? '' : value;
  emit('search');
}

/** 单选式切换治理状态，避免多个互斥状态产生含糊的查询语义。 */
function selectStatus(value: string): void {
  model.value.status = model.value.status === value ? '' : value;
  emit('search');
}

/** 清空所有筛选项并立即刷新市场列表。 */
function clearFilters(): void {
  Object.assign(model.value, { q: '', type: '', status: '', tag: '' });
  emit('search');
}
</script>

<template>
  <aside class="market-filter-panel" aria-label="能力市场筛选">
    <div class="filter-group">
      <div class="filter-group__heading"><strong>能力类型</strong><span>TYPE</span></div>
      <button
        v-for="option in typeOptions"
        :key="option.value"
        :class="['filter-option', { active: model.type === option.value }]"
        type="button"
        @click="selectType(option.value)"
      >
        <span><i />{{ option.label }}</span
        ><small>{{ props.typeCounts[option.value] ?? 0 }}</small>
      </button>
    </div>

    <div class="filter-group">
      <div class="filter-group__heading"><strong>治理状态</strong><span>STATUS</span></div>
      <button
        v-for="option in statusOptions"
        :key="option.value"
        :class="['filter-option', { active: model.status === option.value }]"
        type="button"
        @click="selectStatus(option.value)"
      >
        <span><i />{{ option.label }}</span
        ><small>{{ props.statusCounts[option.value] ?? 0 }}</small>
      </button>
    </div>

    <button
      v-if="model.q || model.type || model.status || model.tag"
      class="clear-filters"
      type="button"
      @click="clearFilters"
    >
      清除全部条件
    </button>
  </aside>
</template>
