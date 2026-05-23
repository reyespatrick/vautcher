<script setup>
import { ref, computed, onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import { site } from '../data/site'
import { fetchEvents } from '../lib/api'
import SiteBlocks from '../components/SiteBlocks.vue'

// Hero background = tenant's own photo when available (first gallery
// item or about image), else a brand-color gradient. Never the
// previously-hardcoded La Gioconda photo.
const heroStyle = computed(() => {
  // Prefer hero.image_url (extractor probes for a landscape image),
  // then fall back to the first gallery image, then about image.
  const img = site.hero?.image_url || site.gallery?.[0]?.src || site.about?.image_url
  if (img) {
    return {
      backgroundImage:
        `linear-gradient(rgba(20,0,8,0.62), rgba(20,0,8,0.66)), url(${img})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center'
    }
  }
  const a = site.brandPrimary || '#9e053d'
  const b = site.brandDark || '#6f032b'
  return { background: `linear-gradient(135deg, ${a}, ${b})` }
})

// Hero / about / specialties come from the tenant's config in
// vautcher_restaurants.config — see app/src/data/site.js. The local
// references via `site.hero`, `site.about`, `site.specialties` keep
// this view tenant-agnostic.

const events = ref([])
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin',
                'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']
function eventDate(d) {
  const dt = new Date(d + 'T00:00:00')
  return `${dt.getDate()} ${MONTHS[dt.getMonth()]}`
}

onMounted(async () => {
  try {
    const { events: list } = await fetchEvents()
    events.value = list.slice(0, 3)
  } catch (e) {
    /* leave events empty — the empty state will show */
  }
})
</script>

<template>
  <div>
    <!-- Hero -->
    <section class="hero" :style="heroStyle">
      <div class="hero-inner">
        <p class="eyebrow">{{ site.hero.eyebrow }}</p>
        <h1>{{ site.hero.title }}</h1>
        <p class="lead">{{ site.hero.lead }}</p>
        <div class="hero-actions">
          <RouterLink to="/reservation" class="btn btn--light">Réserver une table</RouterLink>
          <RouterLink to="/evenements" class="btn btn--light">Nos événements</RouterLink>
        </div>
      </div>
    </section>

    <!-- Quick actions -->
    <section class="quick container">
      <RouterLink to="/reservation" class="quick-card">
        <span>📅</span><strong>Réserver</strong><em>En quelques secondes</em>
      </RouterLink>
      <RouterLink to="/evenements" class="quick-card">
        <span>🎉</span><strong>Événements</strong><em>Nos prochaines soirées</em>
      </RouterLink>
      <RouterLink to="/galerie" class="quick-card">
        <span>📷</span><strong>Galerie</strong><em>Photos &amp; ambiance</em>
      </RouterLink>
      <a :href="site.mapsHref" target="_blank" rel="noopener" class="quick-card">
        <span>🧭</span><strong>Itinéraire</strong><em>{{ site.address }}</em>
      </a>
    </section>

    <!-- Verbatim content blocks extracted from the tenant's website
         (heading / text / image). When present, they replace the
         curated about + specialties sections so we never render an
         editorialised version of what's already on the source. -->
    <SiteBlocks v-if="(site.sections || []).length" :blocks="site.sections" />

    <!-- Curated about — only when sections is empty AND the tenant
         has filled in about content via the editor. -->
    <section
      v-else-if="(site.about?.paragraphs || []).length || site.about?.title"
      class="section about"
    >
      <div class="container about-grid">
        <img v-if="site.about.image_url" :src="site.about.image_url" :alt="site.about.title || site.name" />
        <div>
          <span v-if="site.about.kicker" class="kicker">{{ site.about.kicker }}</span>
          <h2 v-if="site.about.title">{{ site.about.title }}</h2>
          <p v-for="(p, i) in site.about.paragraphs" :key="i">{{ p }}</p>
          <RouterLink to="/contact" class="btn btn--ghost">Nous découvrir</RouterLink>
        </div>
      </div>
    </section>

    <!-- Specialties — only when the tenant actually has some AND
         hasn't gone the verbatim sections route. -->
    <section
      v-if="!(site.sections || []).length && site.specialties && site.specialties.length"
      class="section specialties"
    >
      <div class="container">
        <div class="section-head">
          <span class="kicker">Nos Spécialités</span>
          <h2>{{ site.specialtiesTitle || 'Nos plats' }}</h2>
          <div class="divider"></div>
        </div>
        <div class="spec-grid">
          <article v-for="s in site.specialties" :key="s.title" class="spec-card">
            <div class="spec-icon">{{ s.icon }}</div>
            <h3>{{ s.title }}</h3>
            <p>{{ s.text }}</p>
          </article>
        </div>
      </div>
    </section>

    <!-- Upcoming events -->
    <section class="section events-teaser">
      <div class="container">
        <div class="section-head">
          <span class="kicker">Agenda</span>
          <h2>Événements à venir</h2>
          <div class="divider"></div>
        </div>
        <div v-if="events.length" class="ev-grid">
          <RouterLink
            v-for="ev in events"
            :key="ev.id"
            to="/evenements"
            class="ev-mini"
          >
            <div class="ev-mini-img" :style="{ backgroundImage: `url(${ev.image_url})` }">
              <span class="ev-mini-date">{{ eventDate(ev.event_date) }}</span>
            </div>
            <div class="ev-mini-body">
              <h3>{{ ev.title }}</h3>
              <p>{{ ev.event_time }}<template v-if="ev.location"> · {{ ev.location }}</template></p>
            </div>
          </RouterLink>
        </div>
        <p v-else class="ev-empty">Pas d’événement prévu pour le moment.</p>
        <div class="text-center events-cta">
          <RouterLink to="/evenements" class="btn btn--ghost">Tous les événements</RouterLink>
        </div>
      </div>
    </section>

    <!-- Reservation banner -->
    <section class="cta-banner">
      <div class="container">
        <h2>Envie de nous rejoindre&nbsp;?</h2>
        <p>Réservez votre table en ligne, confirmation immédiate.</p>
        <RouterLink to="/reservation" class="btn btn--light">Réserver maintenant</RouterLink>
      </div>
    </section>
  </div>
</template>

<style scoped>
.hero {
  /* Background is set via :style on the section — driven by the tenant's
     gallery/brand. The static fallback is just a brand-burgundy block. */
  min-height: 70vh;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  color: #fff;
  background-color: var(--burgundy-dark, #6f032b);
}
.hero-inner { max-width: 680px; padding: 56px 22px; }
.eyebrow { font-size: 0.78rem; letter-spacing: 0.26em; text-transform: uppercase; margin-bottom: 14px; }
.hero h1 { font-size: clamp(2.2rem, 7vw, 3.8rem); margin-bottom: 14px; }
.lead { font-weight: 300; font-size: 1.05rem; margin-bottom: 26px; }
.hero-actions { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }

.quick {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 14px;
  margin-top: -38px;
  position: relative;
  z-index: 5;
}
.quick-card {
  background: #fff;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 20px 14px;
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 3px;
  transition: transform 0.15s;
}
.quick-card:hover { transform: translateY(-4px); }
.quick-card span { font-size: 1.7rem; }
.quick-card strong { font-family: 'Rufina', serif; font-size: 1.05rem; color: var(--burgundy); }
.quick-card em { font-style: normal; font-size: 0.78rem; color: var(--grey); }

.about { background: var(--paper); }
.about-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; align-items: center; }
.about-grid img { border-radius: var(--radius); box-shadow: var(--shadow); }
.kicker { color: var(--burgundy); font-size: 0.74rem; font-weight: 700; letter-spacing: 0.2em; text-transform: uppercase; }
.about-grid h2 { font-size: clamp(1.7rem, 4vw, 2.3rem); margin: 8px 0 12px; }
.about-grid p { color: var(--grey); margin-bottom: 14px; }

.spec-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 22px; }
.spec-card {
  text-align: center;
  padding: 30px 22px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  transition: transform 0.15s, box-shadow 0.15s;
}
.spec-card:hover { transform: translateY(-5px); box-shadow: var(--shadow); }
.spec-icon {
  width: 58px; height: 58px;
  margin: 0 auto 14px;
  border-radius: 50%;
  background: var(--burgundy);
  display: flex; align-items: center; justify-content: center;
  font-size: 1.5rem;
}
.spec-card h3 { font-size: 1.2rem; margin-bottom: 6px; }
.spec-card p { color: var(--grey); font-size: 0.9rem; }

.events-teaser { background: var(--paper); }
.ev-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }
.ev-mini {
  background: #fff;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  overflow: hidden;
  box-shadow: var(--shadow);
  transition: transform 0.15s;
}
.ev-mini:hover { transform: translateY(-4px); }
.ev-mini-img {
  position: relative;
  height: 150px;
  background-size: cover;
  background-position: center;
}
.ev-mini-date {
  position: absolute;
  bottom: 10px;
  left: 10px;
  background: var(--burgundy);
  color: #fff;
  font-size: 0.74rem;
  font-weight: 700;
  padding: 4px 11px;
  border-radius: 20px;
}
.ev-mini-body { padding: 14px 16px; }
.ev-mini-body h3 { font-size: 1.1rem; margin-bottom: 4px; }
.ev-mini-body p { color: var(--grey); font-size: 0.84rem; }
.ev-empty { text-align: center; color: var(--grey); }
.events-cta { margin-top: 28px; }

.cta-banner {
  text-align: center;
  color: #fff;
  padding: 64px 0;
  background: linear-gradient(rgba(20, 0, 8, 0.8), rgba(20, 0, 8, 0.8)),
              url('/assets/photo3.jpg') center/cover no-repeat;
}
.cta-banner h2 { font-size: clamp(1.7rem, 4vw, 2.4rem); margin-bottom: 8px; }
.cta-banner p { font-weight: 300; margin-bottom: 22px; }

@media (max-width: 720px) {
  .quick { grid-template-columns: 1fr; }
  .about-grid { grid-template-columns: 1fr; gap: 24px; }
  .spec-grid { grid-template-columns: 1fr; }
  .ev-grid { grid-template-columns: 1fr; }
}
</style>
