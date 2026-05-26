<script setup>
// Thin home dispatcher. Picks the right home renderer for this tenant:
//   1. site.homeHtml present  → BespokeHome (Claude's per-tenant design,
//                               rendered via v-html with scoped CSS)
//   2. else → site.template ('classic' | 'modern') → matching Vue layout.
// ?preview=<name> still forces a specific template at runtime.
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { site } from '../data/site'
import BespokeHome from './home/BespokeHome.vue'
import ClassicHome from './home/ClassicHome.vue'
import ModernHome from './home/ModernHome.vue'

const TEMPLATES = {
  bespoke: BespokeHome,
  classic: ClassicHome,
  modern: ModernHome
}

const route = useRoute()
const activeTemplate = computed(() => {
  const previewKey = String(route.query.preview || '').toLowerCase()
  if (previewKey && TEMPLATES[previewKey]) return previewKey
  if (site.homeHtml) return 'bespoke'
  const configured = String(site.template || 'classic').toLowerCase()
  return TEMPLATES[configured] ? configured : 'classic'
})
const ActiveComponent = computed(() => TEMPLATES[activeTemplate.value])
</script>

<template>
  <component :is="ActiveComponent" />
</template>
