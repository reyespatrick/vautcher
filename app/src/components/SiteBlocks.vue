<script setup>
// Renders the verbatim content blocks the extractor pulled from the
// tenant's website — headings, text, images — in source order, with
// no editorial framing. If the array is empty (the default for tenants
// whose extractor output hasn't been imported), the component renders
// nothing.
//
// Block shapes (see scripts/extract-restaurant.js):
//   { type: 'heading', level, text }
//   { type: 'text', text }
//   { type: 'image', src, alt }
defineProps({
  blocks: { type: Array, default: () => [] }
})
</script>

<template>
  <section v-if="blocks.length" class="site-blocks">
    <div class="container">
      <template v-for="(b, i) in blocks" :key="i">
        <h2 v-if="b.type === 'heading' && b.level <= 2" class="sb-h2">{{ b.text }}</h2>
        <h3 v-else-if="b.type === 'heading'" class="sb-h3">{{ b.text }}</h3>
        <p v-else-if="b.type === 'text'" class="sb-text">{{ b.text }}</p>
        <figure v-else-if="b.type === 'image'" class="sb-image">
          <img :src="b.src" :alt="b.alt || ''" loading="lazy" />
        </figure>
      </template>
    </div>
  </section>
</template>

<style scoped>
.site-blocks {
  padding: 36px 0;
}
.sb-h2 {
  font-family: 'Rufina', Georgia, serif;
  font-size: 1.6rem;
  color: var(--burgundy);
  margin: 30px 0 10px;
}
.sb-h2:first-child { margin-top: 0; }
.sb-h3 {
  font-family: 'Rufina', Georgia, serif;
  font-size: 1.2rem;
  color: var(--ink);
  margin: 22px 0 8px;
}
.sb-text {
  color: var(--grey);
  margin-bottom: 12px;
  line-height: 1.65;
}
.sb-image {
  margin: 18px 0;
  border-radius: var(--radius);
  overflow: hidden;
  box-shadow: 0 8px 26px rgba(0, 0, 0, 0.1);
}
.sb-image img {
  display: block;
  width: 100%;
  height: auto;
  max-height: 380px;
  object-fit: cover;
}
</style>
