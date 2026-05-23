// ============================================================
//  Vautcher user manual — screenshot capture
//
//  Drives the diner app (local, demo-mode build on :8765) and the
//  deployed restowner console (using the `root` shortcut to sign in)
//  to capture every screen used in the PDF.
//
//  Run from docs/manual/ via:   npm run shots
//  Prereq:
//    1. The diner app has been built with empty Supabase env:
//         cd app && VITE_SUPABASE_URL= VITE_SUPABASE_ANON_KEY= npm run build
//    2. A static server serves app/dist/ on port 8765:
//         (cd app/dist && python3 -m http.server 8765)
// ============================================================
import { chromium } from 'playwright'
import { mkdir } from 'fs/promises'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const IMG_DIR = resolve(__dirname, 'img')

const DINER_URL = 'http://127.0.0.1:8765'
const RESTOWNER_URL = 'https://restowner.pages.dev'

const DEMO_PROFILE = {
  id: '11111111-2222-3333-4444-555555555555',
  name: 'Marie',
  birthDate: '1990-04-15'
}

async function shot(page, file) {
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.waitForTimeout(400) // settle animations
  await page.screenshot({ path: `${IMG_DIR}/${file}`, type: 'png' })
  console.log(`  ✓ ${file}`)
}

await mkdir(IMG_DIR, { recursive: true })

const browser = await chromium.launch()
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) ' +
    'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
})

// ============ DINER APP (demo mode) ============
console.log('▸ Diner app')
let page = await ctx.newPage()

// 1. Profile / onboarding dialog (no localStorage profile yet)
await page.goto(DINER_URL + '/')
await page.waitForTimeout(600)
await shot(page, 'client-profile.png')

// Set the demo profile so the rest of the flow has a "user".
await page.evaluate(
  (p) => localStorage.setItem('lagioconda.profile', JSON.stringify(p)),
  DEMO_PROFILE
)

// 2. Voucher card — navigate via the bottom-nav tab so SPA routing works
//    even with our dumb static server.
await page.goto(DINER_URL + '/')
await page.waitForTimeout(400)
await page.locator('a.tab:has-text("Fidélité")').click()
await page.waitForTimeout(700)
await shot(page, 'client-card.png')

// 3. QR modal open
await page.locator('button:has-text("Présenter")').first().click()
await page.waitForTimeout(500)
await shot(page, 'client-qr.png')

// Close the modal and grab the same page scrolled to the wallet button.
await page.keyboard.press('Escape').catch(() => {})
await page.locator('.qr-x').click().catch(() => {})
await page.waitForTimeout(300)
await page.evaluate(() => {
  const el = document.querySelector('.wallet-btn')
  if (el) el.scrollIntoView({ block: 'center', behavior: 'instant' })
})
await page.waitForTimeout(300)
await shot(page, 'client-wallet.png')

// 4. Events list
await page.locator('a.tab:has-text("Agenda")').click()
await page.waitForTimeout(700)
await shot(page, 'client-events.png')

// 5. Home (Accueil)
await page.locator('a.tab:has-text("Accueil")').click()
await page.waitForTimeout(700)
await shot(page, 'client-home.png')

await page.close()

// ============ RESTOWNER (root login, deployed) ============
console.log('▸ Restowner — login flow')
page = await ctx.newPage()

// 6. Owner login — email step with a placeholder address
await page.goto(RESTOWNER_URL + '/login')
await page.waitForLoadState('networkidle').catch(() => {})
await page.waitForTimeout(800)
await page.locator('input').first().fill('proprietaire@demo.ch')
await shot(page, 'owner-login.png')

// 7. Root login — the `root` shortcut
await page.locator('input').first().fill('root')
await page.waitForTimeout(300)
await shot(page, 'root-login.png')
await page.locator('button[type=submit]').click()
// Give the password sign-in + session listener time to settle.
await page.waitForTimeout(4500)
const postLoginUrl = page.url()
console.log('  · after login: ' + postLoginUrl)

console.log('▸ Restowner — owner pages')
// 8. Events dashboard
await page.goto(RESTOWNER_URL + '/')
await page.waitForLoadState('networkidle').catch(() => {})
await page.waitForTimeout(1000)
await shot(page, 'owner-events.png')

// 9. Event editor
await page.goto(RESTOWNER_URL + '/event/new')
await page.waitForLoadState('networkidle').catch(() => {})
await page.waitForTimeout(900)
await shot(page, 'owner-editor.png')

// 10. Scanner
await page.goto(RESTOWNER_URL + '/scan')
await page.waitForTimeout(800)
await shot(page, 'owner-scan.png')

// 11. Vautcher tab (stats + list)
await page.goto(RESTOWNER_URL + '/vouchers')
await page.waitForLoadState('networkidle').catch(() => {})
await page.waitForTimeout(900)
await shot(page, 'owner-vautcher.png')

// 12. Voucher editor
await page.goto(RESTOWNER_URL + '/voucher/new')
await page.waitForTimeout(800)
await shot(page, 'owner-voucher-editor.png')

// 13. History
await page.goto(RESTOWNER_URL + '/history')
await page.waitForLoadState('networkidle').catch(() => {})
await page.waitForTimeout(900)
await shot(page, 'owner-history.png')

// 14. Share QR
await page.goto(RESTOWNER_URL + '/share')
await page.waitForLoadState('networkidle').catch(() => {})
await page.waitForTimeout(1200) // QR canvas paints
await shot(page, 'owner-share.png')

console.log('▸ Restowner — root pages')
// 15. À approuver
await page.goto(RESTOWNER_URL + '/approve')
await page.waitForLoadState('networkidle').catch(() => {})
await page.waitForTimeout(900)
await shot(page, 'root-approve.png')

// 16. Admin tab
await page.goto(RESTOWNER_URL + '/admin')
await page.waitForLoadState('networkidle').catch(() => {})
await page.waitForTimeout(1200)
await shot(page, 'root-admin.png')

await browser.close()
console.log('\nAll screenshots saved to docs/manual/img/')
