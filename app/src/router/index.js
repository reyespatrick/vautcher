import { createRouter, createWebHistory } from 'vue-router'
import { site } from '../data/site'

import HomeView from '../views/HomeView.vue'
import VoucherView from '../views/VoucherView.vue'
import EventsView from '../views/EventsView.vue'
import EventDetailView from '../views/EventDetailView.vue'
import ReservationView from '../views/ReservationView.vue'
import GalleryView from '../views/GalleryView.vue'
import ContactView from '../views/ContactView.vue'

const routes = [
  { path: '/', name: 'home', component: HomeView, meta: { title: 'Accueil' } },
  { path: '/vautcher', name: 'voucher', component: VoucherView, meta: { title: 'Fidélité' } },
  { path: '/evenements', name: 'events', component: EventsView, meta: { title: 'Événements' } },
  { path: '/evenements/:id', name: 'event-detail', component: EventDetailView, meta: { title: 'Événement' } },
  { path: '/reservation', name: 'reservation', component: ReservationView, meta: { title: 'Réservation' } },
  { path: '/galerie', name: 'gallery', component: GalleryView, meta: { title: 'Galerie' } },
  { path: '/contact', name: 'contact', component: ContactView, meta: { title: 'Contact' } },
  { path: '/:pathMatch(.*)*', redirect: '/' }
]

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior() {
    return { top: 0 }
  }
})

router.afterEach((to) => {
  // `site.name` is reactive — once the DB-loaded config arrives it
  // overrides the fallback, and the next navigation picks it up.
  document.title = `${site.name} — ${to.meta.title || ''}`.replace(/—\s*$/, '').trim()
})

export default router
