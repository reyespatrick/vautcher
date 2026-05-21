import { createRouter, createWebHistory } from 'vue-router'
import { useAuth, whenAuthReady } from '../composables/useAuth'

import LoginView from '../views/LoginView.vue'
import DashboardView from '../views/DashboardView.vue'
import EventEditorView from '../views/EventEditorView.vue'
import HistoryView from '../views/HistoryView.vue'
import ScanView from '../views/ScanView.vue'
import ApprovalQueueView from '../views/ApprovalQueueView.vue'

const routes = [
  { path: '/login', name: 'login', component: LoginView, meta: { public: true } },
  { path: '/', name: 'dashboard', component: DashboardView },
  { path: '/event/new', name: 'event-new', component: EventEditorView },
  { path: '/event/:id', name: 'event-edit', component: EventEditorView },
  { path: '/history', name: 'history', component: HistoryView },
  { path: '/scan', name: 'scan', component: ScanView },
  { path: '/approve', name: 'approve', component: ApprovalQueueView },
  { path: '/:pathMatch(.*)*', redirect: '/' }
]

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior() { return { top: 0 } }
})

router.beforeEach(async (to) => {
  console.log('[boot] router: guard awaiting auth for', to.path)
  await whenAuthReady()
  const { session, owner, isModerator } = useAuth()
  console.log('[boot] router: auth gate open, deciding route for', to.path)
  // Access = signed in AND a recognised owner OR moderator.
  const access = !!session.value && (!!owner.value || isModerator.value)

  if (to.meta.public) {
    if (access) return { name: owner.value ? 'dashboard' : 'approve' }
    return true
  }
  if (!access) return { name: 'login' }
  // The approval queue is moderator-only.
  if (to.name === 'approve' && !isModerator.value) return { name: 'dashboard' }
  return true
})

export default router
