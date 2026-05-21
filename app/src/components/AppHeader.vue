<script setup>
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { useProfile } from '../composables/useProfile'

const { profile, openDialog } = useProfile()
const version = __APP_VERSION__

const firstName = computed(() => profile.value?.name.trim().split(/\s+/)[0] || '')
const initial = computed(() => firstName.value.charAt(0).toUpperCase() || '?')
</script>

<template>
  <header class="hdr">
    <div class="hdr-inner">
      <RouterLink to="/" class="brand">
        <img src="/assets/logo.jpg" alt="La Gioconda" />
        <span class="brand-txt">
          La Gioconda
          <small>Ristorante · Pizzeria · v{{ version }}</small>
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
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: var(--header-h);
  background: rgba(255, 255, 255, 0.98);
  border-bottom: 1px solid var(--line);
  z-index: 100;
}
.hdr-inner {
  max-width: 1080px;
  margin: 0 auto;
  height: 100%;
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
  line-height: 1.05;
}
.brand-txt small {
  display: block;
  font-family: 'Montserrat', sans-serif;
  font-size: 0.54rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--grey);
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
