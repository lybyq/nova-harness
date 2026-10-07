<script setup lang="ts">
import {
  ArrowRight,
  CircleCheck,
  CollectionTag,
  Connection,
  MagicStick,
  Monitor,
} from '@element-plus/icons-vue';
import type { Component } from 'vue';
import type { Capability } from '../types';

defineProps<{ rows: Capability[]; loading: boolean }>();
defineEmits<{ select: [capability: Capability] }>();

const statusLabels: Record<string, string> = {
  active: '已审核',
  'needs-review': '待审核',
  disabled: '已停用',
  experimental: '实验性',
  deprecated: '已弃用',
};

const typeIcons: Record<string, Component> = {
  skill: MagicStick,
  mcp: Connection,
  plugin: CollectionTag,
  agent: Monitor,
};

/** 返回适合卡片头像的图标，未登记的新类型使用通用能力图标兜底。 */
function capabilityIcon(item: Capability): Component {
  return typeIcons[item.type] ?? CollectionTag;
}

/** 从治理后的版本集合中提取推荐版本；若未推荐则展示首个可用版本。 */
function recommendedVersion(item: Capability): string {
  return (
    item.versions.find((version) => version.recommended)?.version ??
    item.versions[0]?.version ??
    '暂无版本'
  );
}

/** 将来源 ID 缩短为卡片署名，避免长定位符破坏网格对齐。 */
function sourceLabel(item: Capability): string {
  return item.sourceId.replace(/^source[.:_-]?/i, '') || item.sourceId;
}
</script>

<template>
  <div v-loading="loading" class="market-card-grid" aria-live="polite">
    <button
      v-for="item in rows"
      :key="item.id"
      class="market-card"
      type="button"
      @click="$emit('select', item)"
    >
      <span :class="['market-card__icon', `market-card__icon--${item.type}`]">
        <el-icon><component :is="capabilityIcon(item)" /></el-icon>
      </span>
      <span class="market-card__content">
        <span class="market-card__heading">
          <strong>{{ item.displayName }}</strong>
          <span v-if="item.status === 'active'" class="recommended-badge"
            ><CircleCheck /> 推荐</span
          >
        </span>
        <span class="market-card__description">{{
          item.description || '该能力尚未填写说明。'
        }}</span>
        <span class="market-card__tags">
          <span class="type-chip">{{ item.type }}</span>
          <span v-for="tag in (item.tags ?? []).slice(0, 2)" :key="tag">{{ tag }}</span>
        </span>
      </span>
      <span class="market-card__footer">
        <span>By @{{ sourceLabel(item) }}</span>
        <span class="market-card__version">{{ recommendedVersion(item) }}</span>
        <span :class="['catalog-status', `catalog-status--${item.status}`]">{{
          statusLabels[item.status] ?? item.status
        }}</span>
        <el-icon class="market-card__arrow"><ArrowRight /></el-icon>
      </span>
    </button>

    <el-empty
      v-if="!loading && rows.length === 0"
      class="market-empty"
      description="没有匹配的能力，请尝试减少筛选条件"
    />
  </div>
</template>
