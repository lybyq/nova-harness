<script setup lang="ts">
import { computed, shallowRef } from 'vue';
import type { Capability } from '../types';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useHubApi } from '../composables/useHubApi';
const props = defineProps<{ modelValue: boolean; capability: Capability | undefined }>();
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>();
const open = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
});
const { request } = useHubApi();
const metadataEditor = shallowRef(false);
const metadataText = shallowRef('');
const compatibilityEditor = shallowRef(false);
const compatibilityVersion = shallowRef('');
const compatibilityText = shallowRef('{}');
/** 设置唯一推荐版本。 */
async function recommend(version: string): Promise<void> {
  if (!props.capability) return;
  await request(
    `/capabilities/${encodeURIComponent(props.capability.id)}/versions/${encodeURIComponent(version)}/recommend`,
    { method: 'POST' },
  );
  ElMessage.success('推荐版本已更新');
}
/** 软禁用版本，保留历史 Store 和 Revision。 */
async function disable(version: string): Promise<void> {
  if (!props.capability) return;
  await ElMessageBox.confirm(`确认禁用 ${version}？`, '版本治理', { type: 'warning' });
  await request(
    `/capabilities/${encodeURIComponent(props.capability.id)}/versions/${encodeURIComponent(version)}/disable`,
    { method: 'POST' },
  );
  ElMessage.success('版本已禁用');
}
/** 编辑管理员覆盖字段，来源事实仍由下一次同步刷新。 */
function editMetadata(): void {
  if (!props.capability) return;
  metadataText.value = JSON.stringify(
    {
      displayName: props.capability.displayName,
      description: props.capability.description,
      status: props.capability.status,
      riskLevel: props.capability.riskLevel,
    },
    null,
    2,
  );
  metadataEditor.value = true;
}
/** 保存 capability adminOverrides。 */
async function saveMetadata(): Promise<void> {
  if (!props.capability) return;
  await request(`/capabilities/${encodeURIComponent(props.capability.id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(JSON.parse(metadataText.value) as unknown),
  });
  metadataEditor.value = false;
  ElMessage.success('能力元数据覆盖已保存');
}
/** 打开某版本的 Runtime Compatibility 编辑器。 */
function editCompatibility(version: {
  version: string;
  metadata?: { runtimeBindings?: unknown };
}): void {
  compatibilityVersion.value = version.version;
  compatibilityText.value = JSON.stringify(version.metadata?.runtimeBindings ?? {}, null, 2);
  compatibilityEditor.value = true;
}
/** 保存版本 Runtime Compatibility，并写管理员审计。 */
async function saveCompatibility(): Promise<void> {
  if (!props.capability) return;
  await request(
    `/capabilities/${encodeURIComponent(props.capability.id)}/versions/${encodeURIComponent(compatibilityVersion.value)}/compatibility`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(JSON.parse(compatibilityText.value) as unknown),
    },
  );
  compatibilityEditor.value = false;
  ElMessage.success('Runtime Compatibility 已保存');
}
</script>

<template>
  <el-drawer v-model="open" size="min(620px, 92vw)" destroy-on-close>
    <template #header
      ><div v-if="capability" class="drawer-heading">
        <span class="type-chip">{{ capability.type }}</span>
        <h2>{{ capability.displayName }}</h2>
        <code>{{ capability.id }}</code>
      </div></template
    >
    <template v-if="capability">
      <p class="lead">{{ capability.description || '暂无说明。' }}</p>
      <el-button plain @click="editMetadata">编辑元数据覆盖</el-button>
      <dl class="detail-grid">
        <div>
          <dt>来源</dt>
          <dd>{{ capability.sourceId }}</dd>
        </div>
        <div>
          <dt>定位符</dt>
          <dd>
            <code>{{ capability.sourceLocator }}</code>
          </dd>
        </div>
        <div>
          <dt>状态</dt>
          <dd>{{ capability.status }}</dd>
        </div>
        <div>
          <dt>风险等级</dt>
          <dd>{{ capability.riskLevel }}</dd>
        </div>
      </dl>
      <h3>可用版本</h3>
      <el-table :data="capability.versions" size="small"
        ><el-table-column prop="version" label="版本" /><el-table-column label="推荐" width="90"
          ><template #default="{ row }"
            ><el-tag v-if="row.recommended" type="success" size="small">推荐</el-tag></template
          ></el-table-column
        ><el-table-column label="治理" width="210"
          ><template #default="{ row }"
            ><el-button text @click="recommend(row.version)">推荐</el-button
            ><el-button text @click="editCompatibility(row)">兼容性</el-button
            ><el-button text type="danger" @click="disable(row.version)">禁用</el-button></template
          ></el-table-column
        ><el-table-column prop="commitSha" label="提交 / 完整性" min-width="190"
          ><template #default="{ row }"
            ><code>{{ row.commitSha?.slice(0, 12) ?? row.integrity ?? '—' }}</code></template
          ></el-table-column
        ></el-table
      >
    </template>
    <el-dialog v-model="metadataEditor" title="能力元数据覆盖" append-to-body width="620px">
      <el-input v-model="metadataText" type="textarea" :rows="16" />
      <template #footer
        ><el-button @click="metadataEditor = false">取消</el-button
        ><el-button type="primary" @click="saveMetadata">保存</el-button></template
      >
    </el-dialog>
    <el-dialog
      v-model="compatibilityEditor"
      title="Runtime Compatibility"
      append-to-body
      width="620px"
    >
      <p class="dialog-help">以 Runtime ID 为键填写 compatibility 与 configuration。</p>
      <el-input v-model="compatibilityText" type="textarea" :rows="16" />
      <template #footer
        ><el-button @click="compatibilityEditor = false">取消</el-button
        ><el-button type="primary" @click="saveCompatibility">保存</el-button></template
      >
    </el-dialog>
  </el-drawer>
</template>
