import { createRouter, createWebHistory } from 'vue-router'
import { useAuth, whenAuthReady } from '../composables/useAuth'

import LoginView from '../views/LoginView.vue'
import DashboardView from '../views/DashboardView.vue'
import EventEditorView from '../views/EventEditorView.vue'
import HistoryView from '../views/HistoryView.vue'
import ScanView from '../views/ScanView.vue'

const routes = [
  { path: '/login', name: 'login', component: LoginView, meta: { public: true } },
  { path: '/', name: 'dashboard', component: DashboardView },
  { path: '/event/new', name: 'event-new', component: EventEditorView },
  { path: '/event/:id', name: 'event-edit', component: EventEditorView },
  { path: '/history', name: 'history', component: HistoryView },
  { path: '/scan', name: 'scan', component: ScanView },
  { path: '/:pathMatch(.*)*', redirect: '/' }
]

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior() { return { top: 0 } }
})

router.beforeEach(async (to) => {
  await whenAuthReady()
  const { session, owner } = useAuth()

  // Public routes (login) — bounce to dashboard if already an owner.
  if (to.meta.public) {
    if (session.value && owner.value) return { name: 'dashboard' }
    return true
  }
  // Protected: needs a session AND a recognised owner account.
  if (!session.value || !owner.value) return { name: 'login' }
  return true
})

export default router
