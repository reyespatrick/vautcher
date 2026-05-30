// Floating mockup selector + theme toggle. Loaded from every variant.
(function () {
  var KEPT = [1, 4, 6, 7]
  var NAMES = { 1: 'Revue éditoriale', 4: 'Gazette', 6: 'Noir &amp; or', 7: 'Manifeste' }

  var path = location.pathname.replace(/^\/|\/$/g, '')
  var m = path.match(/^(\d+)$/)
  var current = m ? parseInt(m[1], 10) : 1
  if (KEPT.indexOf(current) === -1) current = 1
  var idx = KEPT.indexOf(current)
  var prev = KEPT[(idx - 1 + KEPT.length) % KEPT.length]
  var next = KEPT[(idx + 1) % KEPT.length]
  var hrefFor = function (n) { return n === 1 ? '/' : '/' + n + '/' }

  // The theme attribute is set by an inline boot script in each
  // page's <head> before first paint to avoid a flash. We just toggle
  // it here and persist the choice. Mockup 6 (Noir & or) is a one-
  // theme design by intent -- its content is the dark identity -- so
  // the toggle is hidden there.
  var noToggle = current === 6
  function getTheme() { return document.documentElement.getAttribute('data-theme') || 'light' }
  function setTheme(t) {
    document.documentElement.setAttribute('data-theme', t)
    try { localStorage.setItem('theme', t) } catch (e) {}
    var btn = document.querySelector('.mk-theme')
    if (btn) btn.innerHTML = t === 'dark' ? '☼' : '☾'
  }
  function toggleTheme() { setTheme(getTheme() === 'dark' ? 'light' : 'dark') }

  var css = ''
    + '.mk-bar{position:fixed;top:0;left:50%;transform:translateX(-50%);z-index:2147483600;'
    + 'display:inline-flex;align-items:center;background:rgba(20,18,22,0.92);color:#fff;'
    + 'padding:0;border-radius:0 0 14px 14px;backdrop-filter:blur(10px);'
    + '-webkit-backdrop-filter:blur(10px);'
    + 'font-family:-apple-system,BlinkMacSystemFont,Inter,system-ui,sans-serif;'
    + 'font-size:12px;font-weight:600;box-shadow:0 8px 28px rgba(0,0,0,0.18);}'
    + '.mk-bar a,.mk-bar button{color:#fff;background:transparent;border:0;cursor:pointer;'
    + 'text-decoration:none;font:inherit;display:inline-flex;align-items:center;'
    + 'padding:8px 12px;}'
    + '.mk-bar a:active,.mk-bar button:active{transform:scale(0.96);}'
    + '.mk-arr{font-size:18px;line-height:1;padding:8px 14px;font-weight:400;}'
    + '.mk-name{padding:8px 6px;font-variant:small-caps;letter-spacing:0.04em;'
    + 'color:rgba(255,255,255,0.92);}'
    + '.mk-cur{padding:8px 4px;color:rgba(255,255,255,0.45);font-variant-numeric:tabular-nums;}'
    + '.mk-list{border-left:1px solid rgba(255,255,255,0.08);font-size:11px;}'
    + '.mk-list:hover{background:rgba(255,255,255,0.06);}'
    + '.mk-theme{border-left:1px solid rgba(255,255,255,0.08);font-size:14px;line-height:1;}'
    + '.mk-theme:hover{background:rgba(255,255,255,0.06);}'
    + '@media print{.mk-bar{display:none!important;}}'

  var style = document.createElement('style')
  style.appendChild(document.createTextNode(css))
  document.head.appendChild(style)

  function build() {
    var bar = document.createElement('div')
    bar.className = 'mk-bar'
    bar.setAttribute('aria-label', 'Mockup selector')
    var themeBtn = noToggle ? '' :
      '<button class="mk-theme" aria-label="Basculer le thème">'
      + (getTheme() === 'dark' ? '☼' : '☾') + '</button>'
    bar.innerHTML =
      '<a class="mk-arr" href="' + hrefFor(prev) + '" aria-label="Précédente">‹</a>'
      + '<span class="mk-name">' + NAMES[current] + '</span>'
      + '<span class="mk-cur">' + (idx + 1) + ' / ' + KEPT.length + '</span>'
      + '<a class="mk-arr" href="' + hrefFor(next) + '" aria-label="Suivante">›</a>'
      + '<a class="mk-list" href="/mockups/">Liste</a>'
      + themeBtn
    document.body.appendChild(bar)
    var btn = bar.querySelector('.mk-theme')
    if (btn) btn.addEventListener('click', toggleTheme)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build)
  } else {
    build()
  }
})()
