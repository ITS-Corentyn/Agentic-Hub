<script setup lang="ts">
withDefaults(defineProps<{ height?: string; rounded?: string }>(), {
  height: '1rem',
  rounded: '0.5rem',
});
</script>

<template>
  <div class="ah-skeleton" :style="{ height, borderRadius: rounded }" />
</template>

<style scoped>
.ah-skeleton {
  width: 100%;
  background: linear-gradient(90deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0.1), rgba(255, 255, 255, 0.04));
  background-size: 200% 100%;
  animation: ah-shimmer 1.3s ease-in-out infinite;
}
@keyframes ah-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
</style>
