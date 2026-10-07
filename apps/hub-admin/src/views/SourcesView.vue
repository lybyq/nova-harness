<script setup lang="ts">
import { computed, onMounted, shallowRef } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import MetricStrip from '../components/MetricStrip.vue';
import PageHeading from '../components/PageHeading.vue';
import { useHubApi } from '../composables/useHubApi';
import type { SyncRun } from '../types';

const { request } = useHubApi();
const runs = shallowRef<SyncRun[]>([]);
const sources = shallowRef<Array<Record<string, unknown>>>([]);
const sourceEditor = shallowRef(false);
const sourceText = shallowRef('');
const sourceId = shallowRef('');
const loading = shallowRef(false);
const runningType = shallowRef<string>();
const metrics = computed(() => [
  { label: '运行总数', value: runs.value.length, detail: '最近 100 次' },
  {
    label: '成功',
    value: runs.value.filter((run) => run.status === 'SUCCEEDED').length,
    detail: '完整同步完成',
  },
  {
    label: '失败',
    value: runs.value.filter((run) => run.status === 'FAILED').length,
    detail: '需检查源或凭据',
  },
]);

async function load(): Promise<void> {
  loading.value = true;
  try {
    [runs.value, sources.value] = await Promise.all([
      request<SyncRun[]>('/sync/runs'),
      request<Array<Record<string, unknown>>>('/sources'),
    ]);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '同步记录加载失败');
  } finally {
    loading.value = false;
  }
}

/** 打开来源 JSON 编辑器；authRef 是引用，Token 不进入表单。 */
function editSource(source: Record<string, unknown>): void {
  sourceId.value = String(source.id);
  sourceText.value = JSON.stringify(source, null, 2);
  sourceEditor.value = true;
}
/** 原子保存 Deployment Profile 中的来源配置。 */
async function saveSource(): Promise<void> {
  await request(`/sources/${encodeURIComponent(sourceId.value)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(JSON.parse(sourceText.value) as unknown),
  });
  ElMessage.success('来源已保存');
  sourceEditor.value = false;
  await load();
}
/** 只执行来源 ping/权限探针。 */
async function testSource(id: string): Promise<void> {
  await request(`/sources/${encodeURIComponent(id)}/test`, { method: 'POST' });
  ElMessage.success(`${id} 连接正常`);
}

/** 仅同步选定来源，适合修复单一 Group/Registry，避免无关来源重复扫描。 */
async function synchronizeSource(id: string): Promise<void> {
  runningType.value = id;
  try {
    await request(`/sync/source/${encodeURIComponent(id)}`, { method: 'POST' });
    ElMessage.success(`${id} 同步完成`);
    await load();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '来源同步失败');
  } finally {
    runningType.value = undefined;
  }
}

async function synchronize(type: 'gitlab' | 'npm' | 'all'): Promise<void> {
  await ElMessageBox.confirm(
    `即将触发 ${type === 'all' ? '全部来源' : type} 的完整同步。`,
    '确认同步',
    { type: 'warning' },
  );
  runningType.value = type;
  try {
    await request(type === 'all' ? '/sync' : `/sync/${type}`, { method: 'POST' });
    ElMessage.success('同步完成');
    await load();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '同步失败');
  } finally {
    runningType.value = undefined;
  }
}

onMounted(load);
</script>

<template>
  <div class="page">
    <PageHeading
      eyebrow="SOURCES"
      title="来源与同步"
      description="同步是带审计记录的全量发现；只有整轮成功才会软删除缺失条目。"
    >
      <el-button :loading="runningType === 'gitlab'" @click="synchronize('gitlab')"
        >同步 GitLab</el-button
      >
      <el-button :loading="runningType === 'npm'" @click="synchronize('npm')">同步 npm</el-button>
      <el-button type="primary" :loading="runningType === 'all'" @click="synchronize('all')"
        >同步全部</el-button
      >
    </PageHeading>
    <MetricStrip :items="metrics" />
    <section class="panel table-panel source-list">
      <el-table :data="sources"
        ><el-table-column prop="displayName" label="来源" /><el-table-column
          prop="type"
          label="类型"
        /><el-table-column prop="id" label="ID" /><el-table-column
          prop="enabled"
          label="启用"
        /><el-table-column label="操作" width="250"
          ><template #default="{ row }"
            ><el-button text @click="testSource(String(row.id))">测试</el-button
            ><el-button
              text
              :loading="runningType === String(row.id)"
              @click="synchronizeSource(String(row.id))"
              >同步</el-button
            ><el-button text @click="editSource(row)">编辑</el-button></template
          ></el-table-column
        ></el-table
      >
    </section>
    <section class="panel table-panel">
      <el-table :data="runs" v-loading="loading" empty-text="尚无同步记录">
        <el-table-column prop="sourceId" label="来源" min-width="160" />
        <el-table-column label="状态" width="130"
          ><template #default="{ row }"
            ><el-tag :type="row.status === 'SUCCEEDED' ? 'success' : 'danger'" effect="plain">{{
              row.status
            }}</el-tag></template
          ></el-table-column
        >
        <el-table-column prop="discovered" label="发现" width="90" /><el-table-column
          prop="created"
          label="新增"
          width="90"
        /><el-table-column prop="updated" label="更新" width="90" /><el-table-column
          prop="failed"
          label="失败"
          width="90"
        />
        <el-table-column label="开始时间" min-width="180"
          ><template #default="{ row }">{{
            new Date(row.startedAt).toLocaleString()
          }}</template></el-table-column
        >
      </el-table>
    </section>
    <el-drawer v-model="sourceEditor" title="来源配置" size="min(700px,96vw)"
      ><p class="dialog-help">仅填写 authRef，Token 请通过部署环境注入。</p>
      <el-input v-model="sourceText" type="textarea" :rows="24" /><template #footer
        ><el-button type="primary" @click="saveSource">保存并校验</el-button></template
      ></el-drawer
    >
  </div>
</template>
