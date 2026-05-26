<script setup>
import { ref, computed, onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import { site, gallery } from '../../data/site'
import { fetchEvents } from '../../lib/api'

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

// site.menu is [{ category, items: [{ name, description, price }] }].
// Filter out categories with zero items so the section stays clean.
const menuWithItems = computed(() =>
  (site.menu || []).filter((c) => Array.isArray(c.items) && c.items.length > 0)
)

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

    <!-- About — structured paragraphs from config.about. We no longer
         dump the verbatim section blocks (.sections) on the home page;
         that produced incoherent walls of ingredient lists, kitchen
         manifestos, and orphan headings depending on the source site
         layout. The verbatim blocks are still stored in the config
         (so they're not lost) but the home page now shows only the
         curated/structured content. -->
    <section
      v-if="(site.about?.paragraphs || []).length || site.about?.title"
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

    <!-- Hierarchical menu — category headers + dishes underneath.
         When the scaffolder + AI got items per category, this is the
         full menu the diner sees. Empty section v-if guards keep the
         page tidy when a tenant has only specialties (no items) or
         only items (no descriptions). -->
    <section
      v-if="menuWithItems.length"
      class="section menu-section"
    >
      <div class="container">
        <div class="section-head">
          <span class="kicker">Notre carte</span>
          <h2>Le menu</h2>
          <div class="divider"></div>
        </div>
        <div class="menu-categories">
          <article v-for="cat in menuWithItems" :key="cat.category" class="menu-cat">
            <h3 class="menu-cat-head">{{ cat.category }}</h3>
            <ul class="menu-items">
              <li v-for="(item, i) in cat.items" :key="i" class="menu-item">
                <div class="menu-item-head">
                  <strong v-if="item.name">{{ item.name }}</strong>
                  <span v-if="item.price" class="menu-item-price">{{ item.price }}</span>
                </div>
                <p v-if="item.description" class="menu-item-desc">{{ item.description }}</p>
                <ul
                  v-if="item.ingredients && item.ingredients.length"
                  class="menu-item-ings"
                >
                  <li v-for="ing in item.ingredients" :key="ing">{{ ing }}</li>
                </ul>
                <ul
                  v-if="item.variants && item.variants.length"
                  class="menu-item-variants"
                >
                  <li v-for="(v, vi) in item.variants" :key="vi">
                    <span class="vlabel">{{ v.label }}</span>
                    <span class="vprice">{{ v.price }}</span>
                  </li>
                </ul>
                <p
                  v-if="item.allergens && item.allergens.length"
                  class="menu-item-allergens"
                >
                  <span class="alabel">Allergènes</span> :
                  {{ item.allergens.join(', ') }}
                </p>
              </li>
            </ul>
          </article>
        </div>
      </div>
    </section>

    <!-- Specialties — fallback for tenants where the menu extractor
         found section headlines but no items underneath. -->
    <section
      v-else-if="site.specialties && site.specialties.length"
      class="section specialties"
    >
      <div class="container">
        <div class="section-head">
          <span class="kicker">Notre carte</span>
          <h2>{{ site.specialtiesTitle || 'Nos plats' }}</h2>
          <div class="divider"></div>
        </div>
        <div class="spec-grid">
          <article v-for="s in site.specialties" :key="s.title" class="spec-card">
            <div class="spec-icon">{{ s.icon }}</div>
            <h3>{{ s.title }}</h3>
            <p v-if="s.text">{{ s.text }}</p>
          </article>
        </div>
      </div>
    </section>

    <!-- Hours teaser — quick reassurance about when the place is open
         before the visitor goes hunting for the Contact page. -->
    <section
      v-if="(site.hours || []).length"
      class="section hours-teaser"
    >
      <div class="container">
        <div class="section-head">
          <span class="kicker">Horaires</span>
          <h2>Quand nous trouver</h2>
          <div class="divider"></div>
        </div>
        <table class="hours-table">
          <tbody>
            <tr v-for="(h, i) in site.hours" :key="i">
              <td>{{ h.days }}</td>
              <td v-if="h.service">{{ h.service }}</td>
              <td>{{ h.time }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- Gallery teaser — up to 6 thumbnails linking to the full gallery. -->
    <section
      v-if="gallery.length"
      class="section gallery-teaser"
    >
      <div class="container">
        <div class="section-head">
          <span class="kicker">Galerie</span>
          <h2>L’ambiance</h2>
          <div class="divider"></div>
        </div>
        <div class="gallery-grid">
          <figure v-for="g in gallery.slice(0, 6)" :key="g.src">
            <img :src="g.src" :alt="g.caption || ''" loading="lazy" />
          </figure>
        </div>
        <div class="text-center events-cta">
          <RouterLink to="/galerie" class="btn btn--ghost">Toute la galerie</RouterLink>
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

/* Hierarchical menu: 2-column grid on desktop, 1 column on mobile.
   Each category is a card; dishes are a vertical list inside. */
.menu-categories {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 28px;
}
.menu-cat {
  background: #fff;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 22px 22px 18px;
  box-shadow: var(--shadow);
}
.menu-cat-head {
  font-family: 'Rufina', serif;
  color: var(--burgundy);
  font-size: 1.25rem;
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--line);
}
.menu-items { list-style: none; padding: 0; margin: 0; }
.menu-item { padding: 10px 0; border-bottom: 1px dashed var(--line); }
.menu-item:last-child { border-bottom: 0; }
.menu-item-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: baseline;
}
.menu-item-head strong {
  font-family: 'Rufina', serif;
  font-size: 1rem;
  color: var(--ink);
}
.menu-item-price {
  font-weight: 700;
  font-size: 0.88rem;
  color: var(--burgundy);
  white-space: nowrap;
}
.menu-item-desc {
  color: var(--grey);
  font-size: 0.88rem;
  margin: 4px 0 0;
  line-height: 1.5;
}
.menu-item-ings {
  list-style: none;
  padding: 0;
  margin: 6px 0 0;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.menu-item-ings li {
  font-size: 0.74rem;
  letter-spacing: 0.02em;
  background: var(--paper);
  border: 1px solid var(--line);
  color: var(--ink);
  padding: 2px 9px;
  border-radius: 999px;
}
.menu-item-variants {
  list-style: none;
  padding: 0;
  margin: 8px 0 0;
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
}
.menu-item-variants li {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  font-size: 0.82rem;
}
.menu-item-variants .vlabel {
  color: var(--grey);
  font-style: italic;
}
.menu-item-variants .vprice {
  font-weight: 700;
  color: var(--burgundy);
}
.menu-item-allergens {
  margin: 6px 0 0;
  font-size: 0.74rem;
  color: var(--grey);
  font-style: italic;
}
.menu-item-allergens .alabel {
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-weight: 700;
  color: var(--ink);
}

.hours-teaser { background: var(--paper); }
.hours-table {
  margin: 0 auto;
  max-width: 480px;
  width: 100%;
  border-collapse: collapse;
}
.hours-table td {
  padding: 12px 8px;
  border-bottom: 1px solid var(--line);
  font-size: 0.95rem;
}
.hours-table tr:last-child td { border-bottom: 0; }
.hours-table td:first-child { font-weight: 600; color: var(--ink); }
.hours-table td:last-child { text-align: right; color: var(--burgundy); font-weight: 600; }

.gallery-teaser .gallery-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-bottom: 18px;
}
.gallery-teaser figure {
  margin: 0;
  border-radius: var(--radius);
  overflow: hidden;
  box-shadow: var(--shadow);
  aspect-ratio: 4 / 3;
}
.gallery-teaser img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

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
  .gallery-teaser .gallery-grid { grid-template-columns: repeat(2, 1fr); }
  .menu-categories { grid-template-columns: 1fr; gap: 18px; }
}
</style>
