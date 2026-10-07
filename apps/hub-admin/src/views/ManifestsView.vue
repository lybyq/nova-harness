<script setup lang="ts">
import { shallowRef } from 'vue';
import { ElMessage } from 'element-plus';
import PageHeading from '../components/PageHeading.vue';
import { useHubApi } from '../composables/useHubApi';
const { request } = useHubApi();
const content = shallowRef('');
const result = shallowRef<unknown>();
/** 校验 Manifest 但不产生写操作。 */ async function validate() {
  result.value = await request('/manifests/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: content.value }),
  });
  ElMessage.success('Manifest 合法');
}
/** 返回填充默认值后的规范化预览。 */ async function preview() {
  result.value = await request('/manifests/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: content.value }),
  });
}
</script>
<template>
  <div class="page">
    <PageHeading
      eyebrow="SCHEMA"
      title="Manifest 校验与预览"
      description="进入来源同步前检查 Capability、Role 或 Deployment 契约。"
      ><el-button @click="preview">预览</el-button
      ><el-button type="primary" @click="validate">校验</el-button></PageHeading
    >
    <section class="manifest-grid">
      <div class="panel manifest-pane">
        <el-input v-model="content" type="textarea" :rows="28" placeholder="粘贴 YAML 或 JSON" />
      </div>
      <pre class="panel manifest-result">{{
        result ? JSON.stringify(result, null, 2) : '等待输入…'
      }}</pre>
    </section>
  </div>
</template>
