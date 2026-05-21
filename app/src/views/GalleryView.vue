<script setup>
import { ref } from 'vue'
import { gallery } from '../data/site'

const lightbox = ref(-1)

function open(i) { lightbox.value = i }
function close() { lightbox.value = -1 }
function next() { lightbox.value = (lightbox.value + 1) % gallery.length }
function prev() { lightbox.value = (lightbox.value - 1 + gallery.length) % gallery.length }
</script>

<template>
  <div>
    <header class="page-head">
      <span class="kicker">Galerie</span>
      <h1>L’ambiance La Gioconda</h1>
      <p>Salle vitrée, bar à vin Da Vinci et terrasse ensoleillée.</p>
    </header>

    <div class="container grid">
      <figure v-for="(photo, i) in gallery" :key="photo.src" @click="open(i)">
        <img :src="photo.src" :alt="photo.caption" />
        <figcaption>{{ photo.caption }}</figcaption>
      </figure>
    </div>

    <!-- Lightbox -->
    <div v-if="lightbox > -1" class="lightbox" @click.self="close">
      <button class="lb-close" @click="close" aria-label="Fermer">✕</button>
      <button class="lb-nav lb-prev" @click="prev" aria-label="Précédent">‹</button>
      <figure class="lb-figure">
        <img :src="gallery[lightbox].src" :alt="gallery[lightbox].caption" />
        <figcaption>{{ gallery[lightbox].caption }}</figcaption>
      </figure>
      <button class="lb-nav lb-next" @click="next" aria-label="Suivant">›</button>
    </div>
  </div>
</template>

<style scoped>
.page-head { text-align: center; padding: 38px 20px 24px; }
.kicker { color: var(--burgundy); font-size: 0.74rem; font-weight: 700; letter-spacing: 0.2em; text-transform: uppercase; }
.page-head h1 { font-size: clamp(2rem, 6vw, 2.8rem); margin: 6px 0; }
.page-head p { color: var(--grey); }

.grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 14px;
  padding-bottom: 50px;
}
figure {
  position: relative;
  overflow: hidden;
  border-radius: var(--radius);
  cursor: pointer;
  aspect-ratio: 4 / 3;
}
figure img { width: 100%; height: 100%; object-fit: cover; transition: transform 0.4s ease; }
figure:hover img { transform: scale(1.07); }
figcaption {
  position: absolute;
  left: 0; right: 0; bottom: 0;
  padding: 18px 14px 10px;
  color: #fff;
  font-size: 0.85rem;
  font-weight: 600;
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.7));
}

.lightbox {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: rgba(15, 0, 6, 0.94);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.lb-figure { max-width: 900px; }
.lb-figure img { width: 100%; max-height: 78vh; object-fit: contain; border-radius: var(--radius); }
.lb-figure figcaption {
  position: static;
  background: none;
  text-align: center;
  padding-top: 12px;
  font-size: 0.95rem;
}
.lb-close {
  position: absolute;
  top: 18px; right: 20px;
  background: none; border: 0;
  color: #fff; font-size: 1.6rem;
  cursor: pointer;
}
.lb-nav {
  background: rgba(255, 255, 255, 0.12);
  border: 0;
  color: #fff;
  font-size: 2rem;
  width: 48px; height: 48px;
  border-radius: 50%;
  cursor: pointer;
  flex: 0 0 auto;
}
.lb-nav:hover { background: var(--burgundy); }
.lb-prev { margin-right: 10px; }
.lb-next { margin-left: 10px; }

@media (min-width: 721px) {
  .grid { grid-template-columns: repeat(4, 1fr); }
}
@media (max-width: 560px) {
  .lb-nav { width: 40px; height: 40px; font-size: 1.6rem; }
}
</style>
