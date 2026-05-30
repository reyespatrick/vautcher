import { createRouter, createWebHistory } from 'vue-router'
import { useAuth, whenAuthReady } from '../composables/useAuth'

import LoginView from '../views/LoginView.vue'
import DashboardView from '../views/DashboardView.vue'
import EventEditorView from '../views/EventEditorView.vue'
import EventDetailView from '../views/EventDetailView.vue'
import EventAttendeesView from '../views/EventAttendeesView.vue'
import HistoryView from '../views/HistoryView.vue'
import ScanView from '../views/ScanView.vue'
import ShareView from '../views/ShareView.vue'
import ApprovalQueueView from '../views/ApprovalQueueView.vue'
import VouchersView from '../views/VouchersView.vue'
import VoucherEditorView from '../views/VoucherEditorView.vue'
import AdminView from '../views/AdminView.vue'
import RestaurantDetailView from '../views/RestaurantDetailView.vue'
import DiscoverView from '../views/DiscoverView.vue'
import QueueView from '../views/QueueView.vue'
import ClientsView from '../views/ClientsView.vue'
import RestaurantConfigView from '../views/RestaurantConfigView.vue'
import InstallView from '../views/InstallView.vue'
import ActivateView from '../views/ActivateView.vue'

const routes = [
  { path: '/login', name: 'login', component: LoginView, meta: { public: true } },
  // Public install landing — reachable by anyone (QR target), and never
  // redirected away even when a moderator is signed in.
  { path: '/install', name: 'install', component: InstallView, meta: { open: true } },
  // Public owner activation — restaurateur enters e-mail + durable code.
  { path: '/activer', name: 'activate', component: ActivateView, meta: { public: true } },
  { path: '/', name: 'dashboard', component: DashboardView },
  { path: '/event/new', name: 'event-new', component: EventEditorView },
  { path: '/event/:id', name: 'event-detail', component: EventDetailView },
  { path: '/event/:id/inscrits', name: 'event-attendees', component: EventAttendeesView },
  { path: '/event/:id/edit', name: 'event-edit', component: EventEditorView },
  { path: '/history', name: 'history', component: HistoryView },
  { path: '/scan', name: 'scan', component: ScanView },
  { path: '/share', name: 'share', component: ShareView },
  { path: '/vouchers', name: 'vouchers', component: VouchersView },
  { path: '/voucher/new', name: 'voucher-new', component: VoucherEditorView },
  { path: '/voucher/:id', name: 'voucher-edit', component: VoucherEditorView },
  { path: '/clients', name: 'clients', component: ClientsView },
  { path: '/approve', name: 'approve', component: ApprovalQueueView },
  { path: '/admin', name: 'admin', component: AdminView },
  { path: '/admin/discover', name: 'admin-discover', component: DiscoverView },
  { path: '/admin/queue', name: 'admin-queue', component: QueueView },
  { path: '/admin/restaurant/:id', name: 'admin-restaurant', component: RestaurantDetailView },
  { path: '/restaurant/:id', name: 'restaurant-config', component: RestaurantConfigView },
  { path: '/:pathMatch(.*)*', redirect: '/' }
]

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior() { return { top: 0 } }
})

router.beforeEach(async (to) => {
  // Always-open routes (e.g. the install landing) render for anyone,
  // signed in or not — skip the auth gate entirely.
  if (to.meta.open) return true
  console.log('[boot] router: guard awaiting auth for', to.path)
  await whenAuthReady()
  const { session, owner, isModerator, isRoot } = useAuth()
  console.log('[boot] router: auth gate open, deciding route for', to.path)
  // Access = signed in AND a recognised owner OR moderator.
  const access = !!session.value && (!!owner.value || isModerator.value)

  if (to.meta.public) {
    if (access) return { name: owner.value ? 'dashboard' : 'approve' }
    return true
  }
  if (!access) return { name: 'login' }
  // The approval queue, admin console and restaurant editor are moderator-only.
  if (['approve', 'admin', 'admin-restaurant', 'restaurant-config'].includes(to.name) && !isModerator.value) {
    return { name: 'dashboard' }
  }
  // The Découvrir page (nearby-restaurant discovery + scaffold queue) is
  // root-only, matching the Admin tab gate in App.vue.
  if ((to.name === 'admin-discover' || to.name === 'admin-queue') && !isRoot.value) {
    return { name: 'dashboard' }
  }
  return true
})

export default router
