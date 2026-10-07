<script setup lang="ts">
import { ArrowRight } from '@element-plus/icons-vue';
import type { Capability } from '../types';

defineProps<{ items: Capability[] }>();
defineEmits<{ select: [capability: Capability] }>();

/** 用稳定 ID 派生纯展示字母，不依赖外部图标资源。 */
function monogram(item: Capability): string {
  return item.displayName.trim().slice(0, 1).toUpperCase() || 'N';
}
</script>

<template>
  <section class="featured-section">
    <div class="section-heading">
      <div>
        <span class="section-kicker">RECOMMENDED</span>
        <h2>推荐能力</h2>
      </div>
      <RouterLink to="/catalog"
        >查看完整目录 <el-icon><ArrowRight /></el-icon
      ></RouterLink>
    </div>
    <div class="featured-grid">
      <button
        v-for="item in items"
        :key="item.id"
        class="featured-card"
        @click="$emit('select', item)"
      >
        <span :class="['capability-avatar', `capability-avatar--${item.type}`]">{{
          monogram(item)
        }}</span>
        <span class="featured-card__content">
          <span class="featured-card__meta"
            >{{ item.type.toUpperCase() }} · {{ item.sourceId }}</span
          >
          <strong>{{ item.displayName }}</strong>
          <small>{{ item.description || '暂无能力说明' }}</small>
          <span class="featured-card__footer">
            <code>{{
              item.versions.find((version) => version.recommended)?.version ?? 'unversioned'
            }}</code>
            <span :class="['status-dot', `status-dot--${item.status}`]">{{
              item.status === 'active' ? '已审核' : '待治理'
            }}</span>
          </span>
        </span>
      </button>
    </div>
  </section>
</template>
