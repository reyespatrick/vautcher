<script setup>
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { useProfile } from '../composables/useProfile'
import { site } from '../data/site'

const { profile, openDialog } = useProfile()

const firstName = computed(() => profile.value?.name.trim().split(/\s+/)[0] || '')
const initial = computed(() => firstName.value.charAt(0).toUpperCase() || '?')

// Restaurant names from og:title are often long compound strings like
// "Pizzeria Da Paolo – Restaurant Italien à Genève". The header looks
// awful when that wraps to 2-3 lines on a phone. Show only the part
// before the first em-dash / pipe / hyphen-with-spaces, fall back to
// the full name otherwise.
const brandName = computed(() => {
  const n = (site.name || '').trim()
  const m = n.split(/\s+[–—|]\s+|\s+-\s+/)[0]
  return m || n
})

// Header subtitle is intentionally tiny — restaurant descriptions that
// run 100+ chars (Da Paolo's "Depuis 1972, le restaurant Da Paolo
// s'efforce de proposer à son aimable clientèle...") look like a wall
// of all-caps junk under the name. Show the subtitle only if it's a
// short tagline (≤ 60 chars after collapsing whitespace).
const brandSubtitle = computed(() => {
  const t = (site.tagline || '').replace(/\s+/g, ' ').trim()
  if (!t || t.length > 60) return ''
  return t
})
</script>

<template>
  <header class="hdr">
    <div class="hdr-inner">
      <RouterLink to="/" class="brand">
        <img :src="site.logoUrl" :alt="site.name" />
        <span class="brand-txt">
          <span class="brand-name">{{ brandName }}</span>
          <small v-if="brandSubtitle">{{ brandSubtitle }}</small>
        </span>
      </RouterLink>

      <nav class="top-nav">
        <RouterLink to="/">Accueil</RouterLink>
        <RouterLink to="/evenements">Événements</RouterLink>
        <RouterLink to="/vautcher">Fidélité</RouterLink>
        <RouterLink to="/galerie">Galerie</RouterLink>
        <RouterLink to="/contact">Contact</RouterLink>
      </nav>

      <RouterLink to="/reservation" class="hdr-cta">Réserver</RouterLink>

      <!-- Profile chip -->
      <button
        v-if="profile"
        class="profile"
        type="button"
        @click="openDialog"
        :title="`Profil de ${profile.name}`"
      >
        <span class="avatar">{{ initial }}</span>
        <span class="profile-name">{{ firstName }}</span>
      </button>
    </div>
  </header>
</template>

<style scoped>
.hdr {
  flex: 0 0 auto;
  background: rgba(255, 255, 255, 0.98);
  border-bottom: 1px solid var(--line);
  z-index: 100;
  /* Clear the status bar / notch in standalone PWA mode. */
  padding-top: env(safe-area-inset-top);
}
.hdr-inner {
  max-width: 1080px;
  margin: 0 auto;
  height: var(--header-h);
  padding: 0 16px;
  display: flex;
  align-items: center;
  gap: 14px;
}
.brand { display: flex; align-items: center; gap: 10px; margin-right: auto; }
.brand img { height: 42px; width: auto; }
.brand-txt {
  font-family: 'Rufina', serif;
  font-size: 1.15rem;
  color: var(--burgundy);
  line-height: 1.1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.brand-name {
  display: block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 60vw;
}
.brand-txt small {
  display: block;
  font-family: 'Montserrat', sans-serif;
  font-size: 0.58rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--grey);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 60vw;
  margin-top: 2px;
}

.top-nav { display: flex; gap: 24px; }
.top-nav a {
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  padding: 4px 0;
  border-bottom: 2px solid transparent;
}
.top-nav a:hover { color: var(--burgundy); }
.top-nav a.router-link-active { color: var(--burgundy); border-color: var(--burgundy); }

.hdr-cta {
  font-size: 0.76rem;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  padding: 9px 18px;
  background: var(--burgundy);
  color: #fff;
  border-radius: var(--radius);
}
.hdr-cta:hover { background: var(--burgundy-dark); }

.profile {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 12px 5px 5px;
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 24px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.profile:hover { border-color: var(--burgundy); }
.avatar {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: var(--burgundy);
  color: #fff;
  font-family: 'Rufina', serif;
  font-weight: 700;
  font-size: 0.92rem;
  display: flex;
  align-items: center;
  justify-content: center;
}
.profile-name {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--ink);
  max-width: 110px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* On phones the top nav is replaced by the bottom tab bar */
@media (max-width: 720px) {
  .top-nav { display: none; }
  .brand img { height: 38px; }
  .brand-txt { font-size: 1rem; }
  .hdr-cta { display: none; }
  .profile-name { display: none; }
  .profile { padding: 4px; }
}
</style>
