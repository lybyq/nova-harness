<script setup lang="ts">
import type { Capability } from '../types';
defineProps<{ rows: Capability[]; loading: boolean }>();
defineEmits<{ select: [capability: Capability] }>();

const statusLabels: Record<string, string> = {
  active: '可用',
  'needs-review': '待审核',
  disabled: '停用',
  experimental: '实验性',
  deprecated: '弃用',
};
</script>

<template>
  <el-table
    :data="rows"
    v-loading="loading"
    row-key="id"
    @row-click="(row: Capability) => $emit('select', row)"
  >
    <el-table-column label="能力" min-width="300"
      ><template #default="{ row }"
        ><div class="capability-name">
          <strong>{{ row.displayName }}</strong
          ><code>{{ row.id }}</code>
        </div></template
      ></el-table-column
    >
    <el-table-column prop="type" label="类型" width="110"
      ><template #default="{ row }"
        ><span class="type-chip">{{ row.type }}</span></template
      ></el-table-column
    >
    <el-table-column label="版本" width="130"
      ><template #default="{ row }">{{
        row.versions?.find((item: Capability['versions'][number]) => item.recommended)?.version ??
        '—'
      }}</template></el-table-column
    >
    <el-table-column prop="sourceId" label="来源" min-width="160" />
    <el-table-column label="风险" width="100"
      ><template #default="{ row }"
        ><span :class="['risk', `risk-${row.riskLevel}`]">{{ row.riskLevel }}</span></template
      ></el-table-column
    >
    <el-table-column label="状态" width="120"
      ><template #default="{ row }"
        ><el-tag :type="row.status === 'active' ? 'success' : 'warning'" effect="plain">{{
          statusLabels[row.status] ?? row.status
        }}</el-tag></template
      ></el-table-column
    >
  </el-table>
</template>
