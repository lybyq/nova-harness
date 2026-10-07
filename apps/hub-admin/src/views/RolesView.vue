<script setup lang="ts">
import { onMounted, shallowRef } from 'vue';
import { ElMessage } from 'element-plus';
import PageHeading from '../components/PageHeading.vue';
import { useHubApi } from '../composables/useHubApi';
import type { CatalogPage } from '../types';
interface RoleRow {
  id: string;
  displayName: string;
  published: boolean;
  versions: Array<{ version: string }>;
}
const { request } = useHubApi();
const rows = shallowRef<RoleRow[]>([]);
const editor = shallowRef(false);
const selectedId = shallowRef('');
const documentText = shallowRef('');
const validation = shallowRef<unknown>();
const capabilityOptions = shallowRef<Array<{ id: string; displayName: string }>>([]);
const selectedCapabilities = shallowRef({
  required: [] as string[],
  recommended: [] as string[],
  optional: [] as string[],
});
/** 加载角色及最新版本摘要。 */ async function load() {
  const [roles, catalog] = await Promise.all([
    request<RoleRow[]>('/roles'),
    request<CatalogPage>('/catalog?pageSize=100'),
  ]);
  rows.value = roles;
  capabilityOptions.value = catalog.data.map((item) => ({
    id: item.id,
    displayName: item.displayName,
  }));
}
/** 打开契约编辑器并保留全部扩展字段。 */ async function open(id: string) {
  selectedId.value = id;
  const document = await request<RoleDocument>(`/roles/${encodeURIComponent(id)}`);
  documentText.value = JSON.stringify(document, null, 2);
  selectedCapabilities.value = {
    required: document.capabilities.required.map((item) => item.id),
    recommended: document.capabilities.recommended.map((item) => item.id),
    optional: document.capabilities.optional.map((item) => item.id),
  };
  editor.value = true;
}
/**
 * 将可视化选择同步回 RoleProfile JSON；已有条目的 range/reason/configuration 原样保留，
 * 新条目使用 `*`，并从其他等级移除以避免同一能力重复声明。
 */
function updateCapabilityLevel(level: 'required' | 'recommended' | 'optional'): void {
  const document = JSON.parse(documentText.value) as RoleDocument;
  const selected = new Set(selectedCapabilities.value[level]);
  const existing = [
    ...document.capabilities.required,
    ...document.capabilities.recommended,
    ...document.capabilities.optional,
  ];
  document.capabilities[level] = [...selected].map(
    (id) =>
      existing.find((item) => item.id === id) ?? { id, range: '*', reason: '', configuration: {} },
  );
  for (const other of ['required', 'recommended', 'optional'] as const) {
    if (other !== level)
      document.capabilities[other] = document.capabilities[other].filter(
        (item) => !selected.has(item.id),
      );
  }
  selectedCapabilities.value = {
    required: document.capabilities.required.map((item) => item.id),
    recommended: document.capabilities.recommended.map((item) => item.id),
    optional: document.capabilities.optional.map((item) => item.id),
  };
  documentText.value = JSON.stringify(document, null, 2);
}
/** 校验 JSON 后保存草稿。 */ async function save() {
  const document: unknown = JSON.parse(documentText.value);
  await request(`/roles/${encodeURIComponent(selectedId.value)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(document),
  });
  ElMessage.success('角色草稿已保存');
  await load();
}
/** 联合校验契约、继承和 Catalog 映射。 */ async function validateRole() {
  const document: unknown = JSON.parse(documentText.value);
  validation.value = await request(`/roles/${encodeURIComponent(selectedId.value)}/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(document),
  });
}
/** 发布角色最新版本。 */ async function publish(id: string) {
  await request(`/roles/${encodeURIComponent(id)}/publish`, { method: 'POST' });
  ElMessage.success('角色已发布');
  await load();
}
onMounted(load);

interface RoleDocument {
  capabilities: Record<
    'required' | 'recommended' | 'optional',
    Array<{ id: string; range?: string; reason?: string; configuration?: Record<string, unknown> }>
  > & { denied: string[] };
  [key: string]: unknown;
}
</script>
<template>
  <div class="page">
    <PageHeading
      eyebrow="GOVERNANCE"
      title="角色治理"
      description="编辑角色继承、能力等级和抽象权限；发布前解析冲突与缺失映射。"
    />
    <section class="panel table-panel">
      <el-table :data="rows"
        ><el-table-column prop="displayName" label="角色" /><el-table-column
          prop="id"
          label="ID"
        /><el-table-column label="版本"
          ><template #default="{ row }">{{
            row.versions?.[0]?.version ?? '—'
          }}</template></el-table-column
        ><el-table-column label="状态"
          ><template #default="{ row }"
            ><el-tag :type="row.published ? 'success' : 'warning'">{{
              row.published ? '已发布' : '草稿'
            }}</el-tag></template
          ></el-table-column
        ><el-table-column label="操作" width="190"
          ><template #default="{ row }"
            ><el-button text @click="open(row.id)">编辑</el-button
            ><el-button text @click="publish(row.id)">发布</el-button></template
          ></el-table-column
        ></el-table
      >
    </section>
    <el-drawer v-model="editor" size="min(760px,96vw)" title="角色契约编辑"
      ><p class="dialog-help">JSON 必须符合 RoleProfile 契约，禁止写入 Secret。</p>
      <el-form label-position="top" class="role-capability-editor">
        <el-form-item label="必选能力">
          <el-select
            v-model="selectedCapabilities.required"
            multiple
            filterable
            style="width: 100%"
            @change="updateCapabilityLevel('required')"
          >
            <el-option
              v-for="item in capabilityOptions"
              :key="item.id"
              :label="`${item.displayName} · ${item.id}`"
              :value="item.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="推荐能力">
          <el-select
            v-model="selectedCapabilities.recommended"
            multiple
            filterable
            style="width: 100%"
            @change="updateCapabilityLevel('recommended')"
          >
            <el-option
              v-for="item in capabilityOptions"
              :key="item.id"
              :label="`${item.displayName} · ${item.id}`"
              :value="item.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="可选能力">
          <el-select
            v-model="selectedCapabilities.optional"
            multiple
            filterable
            style="width: 100%"
            @change="updateCapabilityLevel('optional')"
          >
            <el-option
              v-for="item in capabilityOptions"
              :key="item.id"
              :label="`${item.displayName} · ${item.id}`"
              :value="item.id"
            />
          </el-select>
        </el-form-item>
      </el-form>
      <p class="dialog-help">权限、继承和默认 Agent 可在下方完整契约中编辑。</p>
      <el-input v-model="documentText" type="textarea" :rows="24" />
      <pre v-if="validation" class="validation-result">{{
        JSON.stringify(validation, null, 2)
      }}</pre>
      <template #footer
        ><el-button @click="validateRole">校验</el-button
        ><el-button type="primary" @click="save">保存草稿</el-button></template
      ></el-drawer
    >
  </div>
</template>
