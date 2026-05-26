<script setup>
// Thin home dispatcher. The real rendering lives in templates under
// ./home/ — one Vue file per available design. Owner picks the
// template from restowner; moderator can also force a template via
// the `?preview=` query param for before/after demos (doesn't mutate
// config, just the live render).
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { site } from '../data/site'
import ClassicHome from './home/ClassicHome.vue'
import ModernHome from './home/ModernHome.vue'

const TEMPLATES = {
  classic: ClassicHome,
  modern: ModernHome
}

const route = useRoute()
const activeTemplate = computed(() => {
  const previewKey = String(route.query.preview || '').toLowerCase()
  if (previewKey && TEMPLATES[previewKey]) return previewKey
  const configured = String(site.template || 'classic').toLowerCase()
  return TEMPLATES[configured] ? configured : 'classic'
})
const ActiveComponent = computed(() => TEMPLATES[activeTemplate.value])
</script>

<template>
  <component :is="ActiveComponent" />
</template>
