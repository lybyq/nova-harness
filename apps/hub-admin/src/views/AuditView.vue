<script setup lang="ts">
import { onMounted, shallowRef } from 'vue';
import PageHeading from '../components/PageHeading.vue';
import { useHubApi } from '../composables/useHubApi';
interface AuditRow {
  id: string;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  createdAt: string;
}
const { request } = useHubApi();
const rows = shallowRef<AuditRow[]>([]);
const loading = shallowRef(false);
/** 加载最近管理员审计。 */ async function load() {
  loading.value = true;
  try {
    rows.value = await request<AuditRow[]>('/audit');
  } finally {
    loading.value = false;
  }
}
onMounted(load);
</script>
<template>
  <div class="page">
    <PageHeading eyebrow="AUDIT" title="管理审计" description="追踪来源、能力、版本和角色治理操作。"
      ><el-button :loading="loading" @click="load">刷新</el-button></PageHeading
    >
    <section class="panel table-panel">
      <el-table :data="rows" v-loading="loading"
        ><el-table-column prop="createdAt" label="时间" min-width="180"
          ><template #default="{ row }">{{
            new Date(row.createdAt).toLocaleString()
          }}</template></el-table-column
        ><el-table-column prop="actorId" label="操作者" /><el-table-column
          prop="action"
          label="动作" /><el-table-column prop="resourceType" label="资源类型" /><el-table-column
          prop="resourceId"
          label="资源"
          min-width="180"
      /></el-table>
    </section>
  </div>
</template>
