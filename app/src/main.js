import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import './styles/main.css'

// Last-resort pinch-zoom block for iOS Safari, which ignores both the
// viewport's user-scalable=no AND touch-action: manipulation when in
// "Reader-friendly" mode. preventDefault on the gesture* events kills
// pinch but still allows tap / scroll / swipe.
//
// Also catches double-tap-zoom via dblclick (some iOS builds re-enable
// it when there are clickable elements not wider than ~24px).
if (typeof window !== 'undefined') {
  document.addEventListener('gesturestart',  (e) => e.preventDefault(), { passive: false })
  document.addEventListener('gesturechange', (e) => e.preventDefault(), { passive: false })
  document.addEventListener('gestureend',    (e) => e.preventDefault(), { passive: false })
  document.addEventListener('dblclick',      (e) => e.preventDefault(), { passive: false })
}

createApp(App).use(router).mount('#app')
