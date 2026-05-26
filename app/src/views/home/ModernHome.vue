<script setup>
// Modern home template — same data as ClassicHome, restyled around an
// editorial layout: full-bleed hero, large sans display type, price
// pills, asymmetric menu, sticky reservation CTA on scroll.
//
// Reads tenant config from ../../data/site (identical contract to
// ClassicHome). The brand colour and heading font come through as CSS
// variables / Google Font injections, so this template inherits the
// tenant's identity even though the layout changes.
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { RouterLink } from 'vue-router'
import { site, gallery } from '../../data/site'
import { fetchEvents } from '../../lib/api'

const heroImg = computed(() =>
  site.hero?.image_url || site.gallery?.[0]?.src || site.about?.image_url || ''
)

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

// Sticky bottom CTA shows up after the user has scrolled past the
// hero. Pure visual touch — the existing /reservation link in the
// header still works at all times.
const stickyVisible = ref(false)
function onScroll() {
  stickyVisible.value = window.scrollY > 360
}
onMounted(async () => {
  window.addEventListener('scroll', onScroll, { passive: true })
  try {
    const { events: list } = await fetchEvents()
    events.value = (list || []).slice(0, 3)
  } catch { /* ignore */ }
})
onBeforeUnmount(() => window.removeEventListener('scroll', onScroll))
</script>

<template>
  <div class="modern">
    <!-- ====== HERO ====== -->
    <section class="m-hero">
      <div
        class="m-hero-img"
        :style="heroImg ? { backgroundImage: `url(${heroImg})` } : null"
      >
        <div class="m-hero-overlay"></div>
      </div>
      <div class="m-hero-inner">
        <p v-if="site.hero?.eyebrow" class="m-eyebrow">{{ site.hero.eyebrow }}</p>
        <h1 class="m-display">{{ site.hero?.title || site.name }}</h1>
        <p v-if="site.hero?.lead" class="m-lead">{{ site.hero.lead }}</p>
        <div class="m-hero-actions">
          <RouterLink to="/reservation" class="m-btn m-btn--solid">Réserver une table</RouterLink>
          <a v-if="menuWithItems.length" href="#menu" class="m-btn m-btn--ghost">Voir la carte</a>
        </div>
      </div>
      <a href="#about" class="m-scroll-cue" aria-label="Descendre">
        <span></span>
      </a>
    </section>

    <!-- ====== ABOUT ====== -->
    <section
      v-if="(site.about?.paragraphs || []).length || site.about?.title"
      id="about"
      class="m-about"
    >
      <div class="m-about-grid">
        <div class="m-about-img" v-if="site.about?.image_url || heroImg">
          <img
            :src="site.about?.image_url || heroImg"
            :alt="site.about?.title || site.name"
            loading="lazy"
          />
        </div>
        <div class="m-about-text">
          <span v-if="site.about?.kicker" class="m-eyebrow m-eyebrow--accent">{{ site.about.kicker }}</span>
          <h2 v-if="site.about?.title" class="m-h2">{{ site.about.title }}</h2>
          <h2 v-else class="m-h2">Notre maison</h2>
          <div class="m-rule"></div>
          <p v-for="(p, i) in site.about?.paragraphs || []" :key="i" class="m-prose">{{ p }}</p>
          <RouterLink to="/contact" class="m-link">Nous rencontrer →</RouterLink>
        </div>
      </div>
    </section>

    <!-- ====== MENU ====== -->
    <section v-if="menuWithItems.length" id="menu" class="m-menu">
      <div class="m-menu-head">
        <span class="m-eyebrow m-eyebrow--accent">Notre carte</span>
        <h2 class="m-h2">{{ menuWithItems.length === 1 ? menuWithItems[0].category : 'Le menu' }}</h2>
        <div class="m-rule"></div>
      </div>

      <div class="m-menu-grid">
        <article v-for="cat in menuWithItems" :key="cat.category" class="m-cat">
          <h3 class="m-cat-name">{{ cat.category }}</h3>
          <ul class="m-dish-list">
            <li v-for="(item, i) in cat.items" :key="i" class="m-dish">
              <div class="m-dish-row">
                <span class="m-dish-name">{{ item.name || '—' }}</span>
                <span v-if="!item.variants?.length && item.price" class="m-pill">{{ item.price }}</span>
              </div>
              <p v-if="item.description" class="m-dish-desc">{{ item.description }}</p>
              <ul
                v-if="item.ingredients && item.ingredients.length"
                class="m-chips"
              >
                <li v-for="ing in item.ingredients" :key="ing">{{ ing }}</li>
              </ul>
              <ul
                v-if="item.variants && item.variants.length"
                class="m-variants"
              >
                <li v-for="(v, vi) in item.variants" :key="vi">
                  <span class="m-variants-label">{{ v.label }}</span>
                  <span class="m-pill m-pill--small">{{ v.price }}</span>
                </li>
              </ul>
              <p
                v-if="item.allergens && item.allergens.length"
                class="m-allergens"
              >
                <span>Allergènes</span> · {{ item.allergens.join(', ') }}
              </p>
            </li>
          </ul>
        </article>
      </div>
    </section>

    <!-- Fallback specialties when menu didn't extract -->
    <section
      v-else-if="site.specialties && site.specialties.length"
      class="m-menu"
    >
      <div class="m-menu-head">
        <span class="m-eyebrow m-eyebrow--accent">Spécialités</span>
        <h2 class="m-h2">Nos signatures</h2>
        <div class="m-rule"></div>
      </div>
      <div class="m-spec-grid">
        <article v-for="s in site.specialties" :key="s.title" class="m-spec">
          <div class="m-spec-mark">{{ s.icon || '·' }}</div>
          <h3 class="m-spec-name">{{ s.title }}</h3>
          <p v-if="s.text" class="m-spec-text">{{ s.text }}</p>
        </article>
      </div>
    </section>

    <!-- ====== HOURS ====== -->
    <section v-if="(site.hours || []).length" class="m-hours">
      <div class="m-menu-head">
        <span class="m-eyebrow m-eyebrow--accent">Horaires</span>
        <h2 class="m-h2">Quand nous trouver</h2>
        <div class="m-rule"></div>
      </div>
      <div class="m-hour-strip">
        <div v-for="(h, i) in site.hours" :key="i" class="m-hour-card">
          <div class="m-hour-days">{{ h.days }}</div>
          <div v-if="h.service" class="m-hour-service">{{ h.service }}</div>
          <div class="m-hour-time">{{ h.time }}</div>
        </div>
      </div>
      <a
        v-if="site.mapsHref"
        :href="site.mapsHref"
        target="_blank" rel="noopener"
        class="m-link m-link--center"
      >Itinéraire · {{ site.address }} →</a>
    </section>

    <!-- ====== GALLERY ====== -->
    <section v-if="gallery.length" class="m-gallery">
      <div class="m-menu-head">
        <span class="m-eyebrow m-eyebrow--accent">Galerie</span>
        <h2 class="m-h2">L'ambiance</h2>
        <div class="m-rule"></div>
      </div>
      <div class="m-mosaic">
        <figure
          v-for="(g, i) in gallery.slice(0, 6)" :key="g.src"
          :class="['m-tile', `m-tile--${i % 3}`]"
        >
          <img :src="g.src" :alt="g.caption || ''" loading="lazy" />
        </figure>
      </div>
      <RouterLink to="/galerie" class="m-link m-link--center">Toute la galerie →</RouterLink>
    </section>

    <!-- ====== EVENTS ====== -->
    <section class="m-events">
      <div class="m-menu-head">
        <span class="m-eyebrow m-eyebrow--accent">Agenda</span>
        <h2 class="m-h2">Événements à venir</h2>
        <div class="m-rule"></div>
      </div>
      <div v-if="events.length" class="m-ev-rail">
        <RouterLink
          v-for="ev in events" :key="ev.id"
          to="/evenements"
          class="m-ev"
        >
          <div
            class="m-ev-img"
            :style="ev.image_url ? { backgroundImage: `url(${ev.image_url})` } : null"
          >
            <span class="m-ev-date">{{ eventDate(ev.event_date) }}</span>
          </div>
          <h3 class="m-ev-title">{{ ev.title }}</h3>
          <p class="m-ev-meta">{{ ev.event_time }}<template v-if="ev.location"> · {{ ev.location }}</template></p>
        </RouterLink>
      </div>
      <p v-else class="m-empty">Pas d'événement prévu pour le moment.</p>
      <RouterLink to="/evenements" class="m-link m-link--center">Tous les événements →</RouterLink>
    </section>

    <!-- ====== FINAL CTA ====== -->
    <section class="m-cta">
      <h2 class="m-display m-display--small">Une table vous attend.</h2>
      <p>Confirmation immédiate, sans création de compte.</p>
      <RouterLink to="/reservation" class="m-btn m-btn--solid m-btn--lg">Réserver maintenant</RouterLink>
    </section>

    <!-- ====== STICKY MOBILE CTA ====== -->
    <RouterLink
      to="/reservation"
      :class="['m-sticky', { 'is-visible': stickyVisible }]"
    >Réserver</RouterLink>
  </div>
</template>

<style scoped>
/* Brand tokens come from --burgundy / --burgundy-dark on :root (set
   by app/src/data/site.js per tenant). Layout colours are warmer +
   softer than Classic so the brand colour does pop work. */
.modern {
  --m-ink: #1a1614;
  --m-mut: #6f6760;
  --m-line: #ece6df;
  --m-paper: #faf7f2;
  --m-accent: var(--burgundy, #9e053d);
  --m-accent-dark: var(--burgundy-dark, #6f032b);
  color: var(--m-ink);
  background: var(--m-paper);
  font-family: 'Inter', system-ui, sans-serif;
  letter-spacing: -0.005em;
}

/* ---------- shared bits ---------- */
.m-eyebrow {
  display: inline-block;
  font-size: 0.7rem;
  letter-spacing: 0.32em;
  text-transform: uppercase;
  color: var(--m-mut);
  margin-bottom: 14px;
}
.m-eyebrow--accent { color: var(--m-accent); font-weight: 600; }

.m-h2 {
  font-size: clamp(1.9rem, 4.5vw, 3rem);
  font-weight: 300;
  letter-spacing: -0.015em;
  line-height: 1.05;
  margin: 0;
}

.m-rule {
  width: 60px;
  height: 1px;
  background: var(--m-accent);
  margin: 22px auto 0;
}

.m-prose {
  font-size: 1.02rem;
  line-height: 1.65;
  color: var(--m-ink);
  margin: 14px 0 0;
}

.m-link {
  display: inline-flex;
  align-items: center;
  margin-top: 18px;
  color: var(--m-accent);
  font-weight: 600;
  font-size: 0.94rem;
  border-bottom: 1px solid currentColor;
  padding-bottom: 2px;
}
.m-link:hover { color: var(--m-accent-dark); }
.m-link--center { display: block; text-align: center; width: max-content; margin: 30px auto 0; }

.m-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 0.86rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  padding: 14px 26px;
  border-radius: 0;
  border: 1px solid currentColor;
  transition: transform 0.15s, background 0.15s, color 0.15s;
}
.m-btn:hover { transform: translateY(-1px); }
.m-btn--solid { background: var(--m-accent); color: #fff; border-color: var(--m-accent); }
.m-btn--solid:hover { background: var(--m-accent-dark); border-color: var(--m-accent-dark); }
.m-btn--ghost { color: #fff; border-color: rgba(255,255,255,0.5); background: transparent; }
.m-btn--ghost:hover { background: rgba(255,255,255,0.12); border-color: #fff; }
.m-btn--lg { padding: 18px 38px; font-size: 0.92rem; }

/* ---------- HERO ---------- */
.m-hero {
  position: relative;
  min-height: 86vh;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  color: #fff;
  overflow: hidden;
}
.m-hero-img {
  position: absolute;
  inset: 0;
  background-size: cover;
  background-position: center;
  background-color: var(--m-accent-dark);
}
.m-hero-overlay {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(20,12,8,0.30) 0%, rgba(20,12,8,0.62) 100%);
}
.m-hero-inner {
  position: relative;
  z-index: 1;
  max-width: 820px;
  padding: 80px 24px;
}
.m-hero .m-eyebrow { color: rgba(255,255,255,0.85); }

.m-display {
  font-family: 'Rufina', 'Fraunces', Georgia, serif;
  font-size: clamp(2.6rem, 8vw, 5.5rem);
  font-weight: 400;
  letter-spacing: -0.02em;
  line-height: 1.03;
  margin: 0 0 22px;
  color: inherit;
}
.m-display--small { font-size: clamp(2rem, 5vw, 3.4rem); margin-bottom: 14px; }

.m-lead {
  font-size: 1.12rem;
  font-weight: 300;
  line-height: 1.55;
  margin: 0 auto 36px;
  max-width: 640px;
  opacity: 0.92;
}

.m-hero-actions {
  display: flex;
  gap: 14px;
  justify-content: center;
  flex-wrap: wrap;
}

.m-scroll-cue {
  position: absolute;
  bottom: 28px;
  left: 50%;
  transform: translateX(-50%);
  width: 28px;
  height: 44px;
  border: 1px solid rgba(255,255,255,0.55);
  border-radius: 14px;
  z-index: 1;
}
.m-scroll-cue span {
  position: absolute;
  top: 8px; left: 50%;
  width: 2px; height: 8px;
  background: #fff;
  border-radius: 2px;
  transform: translateX(-50%);
  animation: m-scroll 1.6s ease-in-out infinite;
}
@keyframes m-scroll {
  0%, 100% { transform: translate(-50%, 0); opacity: 0.9; }
  50%      { transform: translate(-50%, 12px); opacity: 0.3; }
}

/* ---------- ABOUT ---------- */
.m-about { padding: 120px 24px; background: #fff; }
.m-about-grid {
  display: grid;
  grid-template-columns: 1.1fr 1fr;
  gap: 80px;
  max-width: 1100px;
  margin: 0 auto;
  align-items: center;
}
.m-about-img img {
  width: 100%;
  height: auto;
  aspect-ratio: 4 / 5;
  object-fit: cover;
  border-radius: 2px;
  box-shadow: 0 20px 60px -25px rgba(0,0,0,0.35);
}
.m-about-text .m-rule { margin: 18px 0 24px; }

/* ---------- MENU ---------- */
.m-menu, .m-hours, .m-gallery, .m-events {
  padding: 110px 24px;
  max-width: 1280px;
  margin: 0 auto;
}
.m-menu { background: var(--m-paper); }
.m-menu-head {
  text-align: center;
  margin-bottom: 60px;
}
.m-menu-head .m-rule { margin-left: auto; margin-right: auto; }

.m-menu-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 60px 80px;
  max-width: 1100px;
  margin: 0 auto;
}
.m-cat-name {
  font-family: 'Rufina', 'Fraunces', Georgia, serif;
  font-size: 1.6rem;
  font-weight: 400;
  letter-spacing: -0.01em;
  color: var(--m-accent);
  margin: 0 0 22px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--m-line);
}
.m-dish-list { list-style: none; padding: 0; margin: 0; }
.m-dish { padding: 16px 0; border-bottom: 1px solid var(--m-line); }
.m-dish:last-child { border-bottom: none; }
.m-dish-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
}
.m-dish-name {
  font-size: 1.02rem;
  font-weight: 500;
  letter-spacing: -0.005em;
}
.m-dish-desc {
  color: var(--m-mut);
  font-size: 0.92rem;
  line-height: 1.55;
  margin: 6px 0 0;
}

.m-pill {
  display: inline-flex;
  align-items: center;
  background: var(--m-accent);
  color: #fff;
  font-weight: 700;
  font-size: 0.84rem;
  padding: 5px 12px;
  border-radius: 999px;
  white-space: nowrap;
}
.m-pill--small { padding: 3px 10px; font-size: 0.78rem; }

.m-chips {
  list-style: none;
  padding: 0;
  margin: 10px 0 0;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.m-chips li {
  font-size: 0.74rem;
  background: #fff;
  border: 1px solid var(--m-line);
  color: var(--m-mut);
  padding: 3px 10px;
  border-radius: 999px;
}

.m-variants {
  list-style: none;
  padding: 0;
  margin: 10px 0 0;
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
}
.m-variants li {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 0.86rem;
}
.m-variants-label {
  color: var(--m-mut);
  font-style: italic;
}

.m-allergens {
  margin: 10px 0 0;
  font-size: 0.74rem;
  color: var(--m-mut);
  font-style: italic;
}
.m-allergens span {
  font-style: normal;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--m-ink);
}

.m-spec-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 32px;
  max-width: 1000px;
  margin: 0 auto;
}
.m-spec {
  text-align: center;
  padding: 32px 24px;
  background: #fff;
  border: 1px solid var(--m-line);
}
.m-spec-mark {
  font-size: 2rem;
  margin-bottom: 14px;
  color: var(--m-accent);
}
.m-spec-name { font-size: 1.15rem; font-weight: 500; margin: 0 0 8px; }
.m-spec-text { font-size: 0.93rem; color: var(--m-mut); line-height: 1.55; }

/* ---------- HOURS ---------- */
.m-hours { background: #fff; }
.m-hour-strip {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 14px;
}
.m-hour-card {
  flex: 0 0 auto;
  min-width: 200px;
  padding: 22px 28px;
  border: 1px solid var(--m-line);
  background: var(--m-paper);
  text-align: center;
}
.m-hour-days { font-weight: 600; font-size: 0.95rem; margin-bottom: 6px; }
.m-hour-service { font-size: 0.74rem; letter-spacing: 0.12em; text-transform: uppercase; color: var(--m-mut); margin-bottom: 8px; }
.m-hour-time { font-family: 'Rufina', 'Fraunces', Georgia, serif; font-size: 1.2rem; color: var(--m-accent); }

/* ---------- GALLERY ---------- */
.m-mosaic {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  grid-auto-rows: 200px;
  gap: 8px;
  max-width: 1100px;
  margin: 0 auto;
}
.m-tile {
  margin: 0;
  overflow: hidden;
  background: var(--m-line);
}
.m-tile--0 { grid-row: span 2; }
.m-tile img { width: 100%; height: 100%; object-fit: cover; transition: transform 0.6s ease; }
.m-tile:hover img { transform: scale(1.04); }

/* ---------- EVENTS ---------- */
.m-events { background: #fff; }
.m-ev-rail {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 28px;
  max-width: 1100px;
  margin: 0 auto;
}
.m-ev { background: var(--m-paper); border: 1px solid var(--m-line); }
.m-ev-img {
  aspect-ratio: 16 / 10;
  background-size: cover;
  background-position: center;
  background-color: var(--m-line);
  position: relative;
}
.m-ev-date {
  position: absolute;
  top: 14px; left: 14px;
  background: rgba(255,255,255,0.96);
  font-size: 0.78rem;
  font-weight: 700;
  padding: 5px 10px;
  letter-spacing: 0.04em;
  color: var(--m-accent);
}
.m-ev-title { font-size: 1.08rem; font-weight: 500; margin: 18px 18px 6px; }
.m-ev-meta { color: var(--m-mut); font-size: 0.88rem; margin: 0 18px 18px; }
.m-empty { text-align: center; color: var(--m-mut); font-style: italic; }

/* ---------- FINAL CTA ---------- */
.m-cta {
  background: var(--m-accent);
  color: #fff;
  text-align: center;
  padding: 120px 24px;
}
.m-cta .m-display { color: #fff; }
.m-cta p { font-size: 1.05rem; opacity: 0.9; margin: 0 0 32px; }
.m-cta .m-btn--solid {
  background: #fff;
  color: var(--m-accent);
  border-color: #fff;
}
.m-cta .m-btn--solid:hover {
  background: var(--m-accent-dark);
  color: #fff;
  border-color: var(--m-accent-dark);
}

/* ---------- STICKY CTA (mobile) ---------- */
.m-sticky {
  position: fixed;
  bottom: 18px;
  left: 50%;
  transform: translate(-50%, 90px);
  background: var(--m-accent);
  color: #fff;
  padding: 14px 32px;
  border-radius: 999px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  font-size: 0.86rem;
  box-shadow: 0 16px 40px -16px rgba(20,0,8,0.6);
  transition: transform 0.35s ease, opacity 0.35s;
  z-index: 90;
  opacity: 0;
}
.m-sticky.is-visible {
  transform: translate(-50%, 0);
  opacity: 1;
}

/* ---------- RESPONSIVE ---------- */
@media (max-width: 800px) {
  .m-about-grid { grid-template-columns: 1fr; gap: 40px; }
  .m-menu-grid { grid-template-columns: 1fr; gap: 48px; }
  .m-mosaic { grid-template-columns: repeat(2, 1fr); grid-auto-rows: 160px; }
  .m-tile--0 { grid-row: span 1; }
  .m-menu, .m-hours, .m-gallery, .m-events, .m-about { padding: 80px 22px; }
  .m-cta { padding: 90px 22px; }
}
@media (max-width: 480px) {
  .m-mosaic { grid-template-columns: 1fr; }
}
@media (min-width: 720px) {
  .m-sticky { display: none; }
}
</style>
