<script setup lang="ts">
defineProps<{ items: Array<{ label: string; value: string | number; detail: string }> }>();
</script>

<template>
  <section class="metric-strip">
    <article v-for="item in items" :key="item.label">
      <span>{{ item.label }}</span
      ><strong>{{ item.value }}</strong
      ><small>{{ item.detail }}</small>
    </article>
  </section>
</template>
