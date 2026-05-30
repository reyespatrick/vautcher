// Floating mockup selector. Loaded from every variant so the user can
// flip between them without going back to /mockups/. Picks the current
// mockup number out of the URL path; default landing (/) is mockup 1.
(function () {
  var path = location.pathname.replace(/^\/|\/$/g, '')
  var m = path.match(/^(\d+)$/)
  var current = m ? parseInt(m[1], 10) : 1
  var total = 10
  var prev = current > 1 ? current - 1 : total
  var next = current < total ? current + 1 : 1
  var prevHref = prev === 1 ? '/' : '/' + prev + '/'
  var nextHref = next === 1 ? '/' : '/' + next + '/'

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
    + '.mk-bar a:active{transform:scale(0.96);}'
    + '.mk-arr{font-size:18px;line-height:1;padding:8px 14px;font-weight:400;}'
    + '.mk-lbl{padding:8px 4px;color:rgba(255,255,255,0.5);font-size:10px;letter-spacing:0.1em;'
    + 'text-transform:uppercase;}'
    + '.mk-cur{padding:8px 4px;font-variant-numeric:tabular-nums;}'
    + '.mk-list{border-left:1px solid rgba(255,255,255,0.08);font-size:11px;}'
    + '.mk-list:hover{background:rgba(255,255,255,0.06);}'
    + '@media print{.mk-bar{display:none!important;}}'

  var style = document.createElement('style')
  style.appendChild(document.createTextNode(css))
  document.head.appendChild(style)

  function build() {
    var bar = document.createElement('div')
    bar.className = 'mk-bar'
    bar.setAttribute('aria-label', 'Mockup selector')
    bar.innerHTML =
      '<a class="mk-arr" href="' + prevHref + '" aria-label="Précédente">‹</a>'
      + '<span class="mk-lbl">Maquette</span>'
      + '<span class="mk-cur">' + current + ' / ' + total + '</span>'
      + '<a class="mk-arr" href="' + nextHref + '" aria-label="Suivante">›</a>'
      + '<a class="mk-list" href="/mockups/">Liste</a>'
    document.body.appendChild(bar)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build)
  } else {
    build()
  }
})()
