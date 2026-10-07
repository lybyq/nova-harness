<script setup lang="ts">
import { ArrowRight, Search } from '@element-plus/icons-vue';
import { shallowRef } from 'vue';

defineProps<{ total: number | string; online: boolean }>();
const emit = defineEmits<{ search: [query: string]; browseType: [type: string] }>();
const query = shallowRef('');

/** 提交首页检索，空查询会进入完整目录。 */
function submit(): void {
  emit('search', query.value.trim());
}
</script>

<template>
  <section class="hub-hero">
    <div class="hub-hero__copy">
      <div class="hero-badge"><i :class="{ online }" /> 企业能力目录 · {{ total }} 项可发现</div>
      <h1>把内网 Agent 能力<br /><em>装进每个团队。</em></h1>
      <p>
        在一个入口发现、组合和治理 MCP、Skill 与 Plugin；用角色预设把可靠的能力交付到 Claude Code。
      </p>
      <form class="hero-search" role="search" @submit.prevent="submit">
        <el-input v-model="query" size="large" placeholder="试试 jira、代码评审、测试流程…">
          <template #prefix
            ><el-icon><Search /></el-icon
          ></template>
        </el-input>
        <el-button type="primary" size="large" native-type="submit">
          搜索目录<el-icon><ArrowRight /></el-icon>
        </el-button>
      </form>
      <div class="hero-shortcuts">
        <span>快速浏览</span>
        <button
          v-for="type in ['mcp', 'skill', 'plugin', 'agent']"
          :key="type"
          @click="emit('browseType', type)"
        >
          {{ type.toUpperCase() }}
        </button>
      </div>
    </div>
    <div class="hub-hero__artifact" aria-hidden="true">
      <div class="artifact-grid">
        <span class="artifact-node artifact-node--one">MCP</span>
        <span class="artifact-node artifact-node--two">SKILL</span>
        <span class="artifact-node artifact-node--three">PLUGIN</span>
        <span class="artifact-core">N</span>
        <i class="artifact-line artifact-line--one" />
        <i class="artifact-line artifact-line--two" />
        <i class="artifact-line artifact-line--three" />
      </div>
    </div>
  </section>
</template>
