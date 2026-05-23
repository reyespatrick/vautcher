<script setup>
import { RouterLink } from 'vue-router'
import { site } from '../data/site'
</script>

<template>
  <div>
    <header class="page-head">
      <span class="kicker">Présentation &amp; Contact</span>
      <h1>Nous trouver</h1>
      <p v-if="site.tagline">{{ site.tagline }}</p>
    </header>

    <div class="container info-grid">
      <!-- Story + details -->
      <div>
        <section v-if="site.about?.paragraphs?.length" class="block">
          <h2>{{ site.about.kicker || 'Notre maison' }}</h2>
          <p v-for="(p, i) in site.about.paragraphs" :key="i">{{ p }}</p>
        </section>

        <section class="block">
          <h2>Coordonnées</h2>
          <ul class="details">
            <li><span>📍</span><a :href="site.mapsHref" target="_blank" rel="noopener">{{ site.address }}</a></li>
            <li><span>☎</span><a :href="site.phoneHref">{{ site.phone }}</a></li>
            <li><span>✉</span><a :href="`mailto:${site.email}`">{{ site.email }}</a></li>
          </ul>
        </section>

        <section class="block">
          <h2>Horaires</h2>
          <table class="hours">
            <tbody>
              <tr v-for="(h, i) in site.hours" :key="i">
                <td>{{ h.days }}</td>
                <td>{{ h.service }}</td>
                <td>{{ h.time }}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <div class="actions">
          <a :href="site.phoneHref" class="btn">Appeler</a>
          <RouterLink to="/reservation" class="btn btn--ghost">Réserver une table</RouterLink>
        </div>
      </div>

      <!-- Map -->
      <a v-if="site.mapsHref" :href="site.mapsHref" target="_blank" rel="noopener" class="map">
        <img :src="site.gallery?.[2]?.src || site.about?.image_url || '/assets/logo.jpg'"
             :alt="site.name" />
        <span class="map-pin">📍 Ouvrir dans Google Maps</span>
      </a>
    </div>
  </div>
</template>

<style scoped>
.page-head { text-align: center; padding: 38px 20px 24px; }
.kicker { color: var(--burgundy); font-size: 0.74rem; font-weight: 700; letter-spacing: 0.2em; text-transform: uppercase; }
.page-head h1 { font-size: clamp(2rem, 6vw, 2.8rem); margin: 6px 0; }
.page-head p { color: var(--grey); }

.info-grid {
  display: grid;
  grid-template-columns: 1.1fr 0.9fr;
  gap: 36px;
  padding-bottom: 50px;
}
.block { margin-bottom: 26px; }
.block h2 {
  font-size: 1.35rem;
  color: var(--burgundy);
  margin-bottom: 8px;
}
.block p { color: var(--grey); }

.details { list-style: none; }
.details li { display: flex; gap: 10px; align-items: baseline; margin-bottom: 8px; }
.details li span { width: 22px; }
.details a:hover { color: var(--burgundy); }

.hours { width: 100%; border-collapse: collapse; }
.hours td { padding: 8px 0; border-bottom: 1px solid var(--line); font-size: 0.92rem; }
.hours td:nth-child(2) { color: var(--burgundy); font-weight: 600; }
.hours td:last-child { text-align: right; }

.actions { display: flex; gap: 12px; flex-wrap: wrap; }

.map {
  position: relative;
  border-radius: var(--radius);
  overflow: hidden;
  box-shadow: var(--shadow);
  min-height: 280px;
}
.map img { width: 100%; height: 100%; object-fit: cover; min-height: 280px; }
.map-pin {
  position: absolute;
  left: 50%; bottom: 18px;
  transform: translateX(-50%);
  background: #fff;
  color: var(--burgundy);
  font-weight: 700;
  font-size: 0.82rem;
  padding: 10px 16px;
  border-radius: 20px;
  box-shadow: var(--shadow);
  white-space: nowrap;
}

@media (max-width: 720px) {
  .info-grid { grid-template-columns: 1fr; gap: 24px; }
}
</style>
