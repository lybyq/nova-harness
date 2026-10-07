<script setup lang="ts">
import {
  Box,
  Connection,
  DataAnalysis,
  DocumentChecked,
  Grid,
  List,
  Monitor,
  Search,
  UserFilled,
} from '@element-plus/icons-vue';
import { computed, onMounted, shallowRef } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useHubApi } from '../composables/useHubApi';

const route = useRoute();
const router = useRouter();
const { request } = useHubApi();
const query = shallowRef(typeof route.query.q === 'string' ? route.query.q : '');
const hubStatus = shallowRef<'checking' | 'online' | 'offline'>('checking');
const isCatalogRoute = computed(() => route.path.startsWith('/catalog'));

/** 从顶栏进入统一能力搜索，并把搜索词写入 URL 以支持复制链接与浏览器回退。 */
async function submitSearch(): Promise<void> {
  const value = query.value.trim();
  await router.push({ path: '/catalog', query: value ? { q: value } : {} });
}

/** 顶栏仅进行轻量健康探测，不触发来源同步或 Runtime 深度检查。 */
async function checkHealth(): Promise<void> {
  try {
    await request('/health');
    hubStatus.value = 'online';
  } catch {
    hubStatus.value = 'offline';
  }
}

onMounted(checkHealth);
</script>

<template>
  <div class="app-shell">
    <header class="site-header">
      <RouterLink class="brand" to="/catalog" aria-label="返回 Nova Hub 能力市场">
        <span class="brand-mark"><Box /></span>
        <span class="brand-name">Nova <strong>Hub</strong></span>
      </RouterLink>

      <nav class="primary-nav" aria-label="主导航">
        <RouterLink to="/catalog" :class="{ active: isCatalogRoute }">
          <el-icon><Grid /></el-icon><span>能力市场</span>
        </RouterLink>
        <RouterLink to="/overview"
          ><el-icon><DataAnalysis /></el-icon><span>运行总览</span></RouterLink
        >
        <el-dropdown trigger="click" popper-class="governance-menu">
          <button class="governance-trigger">
            <el-icon><Monitor /></el-icon><span>治理中心</span><i />
          </button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item @click="router.push('/sources')">
                <el-icon><Connection /></el-icon>来源与同步
              </el-dropdown-item>
              <el-dropdown-item @click="router.push('/roles')">
                <el-icon><UserFilled /></el-icon>角色组合
              </el-dropdown-item>
              <el-dropdown-item @click="router.push('/manifests')">
                <el-icon><DocumentChecked /></el-icon>Manifest 实验室
              </el-dropdown-item>
              <el-dropdown-item @click="router.push('/audit')">
                <el-icon><List /></el-icon>审计记录
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </nav>

      <form
        v-if="!isCatalogRoute"
        class="header-search"
        role="search"
        @submit.prevent="submitSearch"
      >
        <el-input v-model="query" clearable placeholder="搜索能力...">
          <template #prefix
            ><el-icon><Search /></el-icon
          ></template>
        </el-input>
      </form>

      <div class="header-actions">
        <span :class="['hub-state', `hub-state--${hubStatus}`]">
          <i />{{
            hubStatus === 'online' ? 'Hub 在线' : hubStatus === 'offline' ? 'Hub 离线' : '连接中'
          }}
        </span>
        <span class="open-access">免登录访问</span>
      </div>
    </header>

    <main class="workspace"><RouterView /></main>
  </div>
</template>
