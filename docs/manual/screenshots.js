// ============================================================
//  Vautcher user manual — screenshot capture
//
//  Drives the diner app (local, demo-mode build on :8765, SPA-served
//  by `vite preview`) and the deployed restowner console (root login)
//  to capture every screen used in the PDF.
//
//  Run from docs/manual/:   npm run shots
//  Prereq:
//    1. Diner app built with empty Supabase env:
//         cd app && VITE_SUPABASE_URL= VITE_SUPABASE_ANON_KEY= npm run build
//    2. Diner served with SPA fallback (preserves ?demoState= on /vautcher):
//         cd app && npx vite preview --port 8765
// ============================================================
import { chromium } from 'playwright'
import { mkdir } from 'fs/promises'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const IMG_DIR = resolve(__dirname, 'img')
const MOCK_DIR = resolve(__dirname, 'mocks')

const DINER_URL = 'http://127.0.0.1:8765'
const RESTOWNER_URL = 'https://restowner.pages.dev'

const DEMO_PROFILE = {
  id: '11111111-2222-3333-4444-555555555555',
  name: 'Marie',
  birthDate: '1990-04-15'
}

async function shot(page, file) {
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.waitForTimeout(400)
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

// ============ INSTALL MOCKUP (static HTML) ============
console.log('▸ Install mockup')
{
  const mockPage = await ctx.newPage()
  await mockPage.goto('file://' + MOCK_DIR + '/install.html')
  await mockPage.waitForTimeout(500)
  await shot(mockPage, 'client-install.png')
  await mockPage.close()
}

// ============ DINER APP (demo mode, vite preview) ============
console.log('▸ Diner app')
let page = await ctx.newPage()

// 1. Profile / onboarding dialog
await page.goto(DINER_URL + '/')
await page.waitForTimeout(700)
await shot(page, 'client-profile.png')

await page.evaluate(
  (p) => localStorage.setItem('lagioconda.profile', JSON.stringify(p)),
  DEMO_PROFILE
)

// 2. Voucher card (active, ~7/10) — direct nav now that vite preview
//    handles SPA fallback.
await page.goto(DINER_URL + '/vautcher')
await page.waitForTimeout(800)
await shot(page, 'client-card.png')

// 3. QR modal open
await page.locator('button:has-text("Présenter")').first().click()
await page.waitForTimeout(500)
await shot(page, 'client-qr.png')
await page.locator('.qr-x').click().catch(() => {})
await page.waitForTimeout(250)

// 4. Wallet button
await page.evaluate(() => {
  const el = document.querySelector('.wallet-btn')
  if (el) el.scrollIntoView({ block: 'center', behavior: 'instant' })
})
await page.waitForTimeout(250)
await shot(page, 'client-wallet.png')

// 5. Completed-voucher variant — ?demoState=complete swaps DEMO_VOUCHER
//    for the 10/10 COMPLETE_DEMO_VOUCHER.
await page.goto(DINER_URL + '/vautcher?demoState=complete')
await page.waitForTimeout(800)
await shot(page, 'client-card-complete.png')
await page.locator('button:has-text("Présenter")').first().click()
await page.waitForTimeout(500)
await shot(page, 'client-qr-complete.png')
await page.locator('.qr-x').click().catch(() => {})

// 6. Events list
await page.goto(DINER_URL + '/evenements')
await page.waitForTimeout(700)
await shot(page, 'client-events.png')

// 7. Home
await page.goto(DINER_URL + '/')
await page.waitForTimeout(700)
await shot(page, 'client-home.png')

await page.close()

// ============ RESTOWNER — login flow (with OTP intercept) ============
console.log('▸ Restowner — login flow')
page = await ctx.newPage()

// Intercept OTP send so submitting any email advances to the code step
// without actually emailing anyone.
await page.route('**/auth/v1/otp', (route) => route.fulfill({
  status: 200, contentType: 'application/json', body: '{}'
}))

await page.goto(RESTOWNER_URL + '/login')
await page.waitForLoadState('networkidle').catch(() => {})
await page.waitForTimeout(800)

// Owner email step
await page.locator('input').first().fill('proprietaire@demo.ch')
await shot(page, 'owner-login.png')

// Advance to code step (mocked) — capture the 6-digit input screen
await page.locator('button[type=submit]').click()
await page.waitForTimeout(800)
await page.locator('input').first().fill('123456').catch(() => {})
await page.waitForTimeout(300)
await shot(page, 'owner-login-code.png')

// Back to email step, type root, capture, submit (real login)
await page.locator('button.link').click()
await page.waitForTimeout(400)
await page.locator('input').first().fill('root')
await shot(page, 'root-login.png')
await page.locator('button[type=submit]').click()
await page.waitForTimeout(4500)
console.log('  · after login: ' + page.url())

// ============ RESTOWNER — owner views ============
console.log('▸ Restowner — owner pages')
await page.goto(RESTOWNER_URL + '/')
await page.waitForLoadState('networkidle').catch(() => {})
await page.waitForTimeout(1000)
await shot(page, 'owner-events.png')

await page.goto(RESTOWNER_URL + '/event/new')
await page.waitForLoadState('networkidle').catch(() => {})
await page.waitForTimeout(900)
await shot(page, 'owner-editor.png')

// Scanner — placeholder state
await page.goto(RESTOWNER_URL + '/scan')
await page.waitForTimeout(800)
await shot(page, 'owner-scan.png')

// Scanner — with a fake successful-stamp result via ?demo=stamp
await page.goto(RESTOWNER_URL + '/scan?demo=stamp')
await page.waitForTimeout(900)
await shot(page, 'owner-scan-result.png')

await page.goto(RESTOWNER_URL + '/vouchers')
await page.waitForLoadState('networkidle').catch(() => {})
await page.waitForTimeout(900)
await shot(page, 'owner-vautcher.png')

await page.goto(RESTOWNER_URL + '/voucher/new')
await page.waitForTimeout(800)
await shot(page, 'owner-voucher-editor.png')

await page.goto(RESTOWNER_URL + '/history')
await page.waitForLoadState('networkidle').catch(() => {})
await page.waitForTimeout(900)
await shot(page, 'owner-history.png')

await page.goto(RESTOWNER_URL + '/share')
await page.waitForLoadState('networkidle').catch(() => {})
await page.waitForTimeout(1200)
await shot(page, 'owner-share.png')

// ============ RESTOWNER — root views ============
console.log('▸ Restowner — root pages')
await page.goto(RESTOWNER_URL + '/approve')
await page.waitForLoadState('networkidle').catch(() => {})
await page.waitForTimeout(900)
await shot(page, 'root-approve.png')

await page.goto(RESTOWNER_URL + '/admin')
await page.waitForLoadState('networkidle').catch(() => {})
await page.waitForTimeout(1200)
await shot(page, 'root-admin.png')

// Click the Clients segment to capture the diner list too
await page.locator('button:has-text("Clients")').click()
await page.waitForTimeout(900)
await shot(page, 'root-admin-clients.png')

await browser.close()
console.log('\nAll screenshots saved to docs/manual/img/')
