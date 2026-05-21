import { createRouter, createWebHistory } from 'vue-router'

import HomeView from '../views/HomeView.vue'
import VoucherView from '../views/VoucherView.vue'
import EventsView from '../views/EventsView.vue'
import ReservationView from '../views/ReservationView.vue'
import GalleryView from '../views/GalleryView.vue'
import ContactView from '../views/ContactView.vue'

const routes = [
  { path: '/', name: 'home', component: HomeView, meta: { title: 'Accueil' } },
  { path: '/vautcher', name: 'voucher', component: VoucherView, meta: { title: 'Fidélité' } },
  { path: '/evenements', name: 'events', component: EventsView, meta: { title: 'Événements' } },
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
  document.title = `La Gioconda — ${to.meta.title || 'Restaurant Pizzeria'}`
})

export default router
