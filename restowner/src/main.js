import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import { i18n } from './i18n'
import './styles/main.css'

console.log('[boot] main.js: creating + mounting app')
createApp(App).use(router).use(i18n).mount('#app')
console.log('[boot] main.js: app.mount() returned')
