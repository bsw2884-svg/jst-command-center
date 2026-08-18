const selectorFor = (element: Element) => {
  if (element.id) return `#${element.id}`
  const parts: string[] = []
  let node: Element | null = element
  while (node && parts.length < 4) {
    let part = node.tagName.toLowerCase()
    if (node.classList.length) part += `.${[...node.classList].join('.')}`
    parts.unshift(part)
    node = node.parentElement
  }
  return parts.join(' > ')
}

const rounded = (value: number) => Math.round(value * 100) / 100

export const installViewportDebugOverlay = () => {
  if (new URLSearchParams(location.search).get('viewportDebug') !== '1') return () => undefined

  const overlay = document.createElement('div')
  overlay.id = 'jst-viewport-debug-overlay'
  overlay.setAttribute('aria-label', 'Viewport diagnostics')
  const important = (property: string, value: string) => overlay.style.setProperty(property, value, 'important')
  important('all', 'initial')
  important('display', 'block')
  important('position', 'fixed')
  important('top', '0')
  important('left', '0')
  important('z-index', '2147483647')
  important('width', '100%')
  important('max-width', '100%')
  important('max-height', '100vh')
  important('box-sizing', 'border-box')
  important('margin', '0')
  important('padding', '8px')
  important('overflow', 'auto')
  important('background', '#000')
  important('color', '#fff')
  important('font-family', 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace')
  important('font-size', '11px')
  important('font-weight', '400')
  important('line-height', '1.4')
  important('white-space', 'pre-wrap')
  important('overflow-wrap', 'anywhere')
  important('text-align', 'left')
  important('transform', 'none')
  important('opacity', '1')
  important('visibility', 'visible')

  document.body.appendChild(overlay)

  let animationFrame = 0
  const render = () => {
    const widest = [...document.querySelectorAll('html, body, body *')]
      .filter(element => element !== overlay && !overlay.contains(element))
      .map(element => ({ element, width: element.getBoundingClientRect().width }))
      .sort((a, b) => b.width - a.width)[0]
    const root = document.querySelector('#root')
    const viewportMeta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]')
    overlay.textContent = [
      `location.href: ${location.href}`,
      `navigator.userAgent: ${navigator.userAgent}`,
      `window.innerWidth: ${window.innerWidth}`,
      `window.innerHeight: ${window.innerHeight}`,
      `document.documentElement.clientWidth: ${document.documentElement.clientWidth}`,
      `document.documentElement.scrollWidth: ${document.documentElement.scrollWidth}`,
      `window.visualViewport?.width: ${window.visualViewport?.width ?? 'unavailable'}`,
      `window.visualViewport?.height: ${window.visualViewport?.height ?? 'unavailable'}`,
      `screen.width: ${window.screen.width}`,
      `screen.height: ${window.screen.height}`,
      `window.devicePixelRatio: ${window.devicePixelRatio}`,
      `viewport meta: ${viewportMeta?.content ?? 'missing'}`,
      `<600px media query matches: ${window.matchMedia('(max-width: 600px)').matches}`,
      `document.body rect width: ${rounded(document.body.getBoundingClientRect().width)}`,
      `#root rect width: ${root ? rounded(root.getBoundingClientRect().width) : 'missing'}`,
      `widest selector: ${widest ? selectorFor(widest.element) : 'none'}`,
      `widest rect width: ${widest ? rounded(widest.width) : 'unavailable'}`,
    ].join('\n')
  }
  const update = () => {
    cancelAnimationFrame(animationFrame)
    animationFrame = requestAnimationFrame(render)
  }

  window.addEventListener('resize', update)
  window.addEventListener('orientationchange', update)
  window.addEventListener('pageshow', update)
  window.visualViewport?.addEventListener('resize', update)
  update()
  window.setTimeout(update, 250)
  window.setTimeout(update, 1000)

  return () => {
    cancelAnimationFrame(animationFrame)
    window.removeEventListener('resize', update)
    window.removeEventListener('orientationchange', update)
    window.removeEventListener('pageshow', update)
    window.visualViewport?.removeEventListener('resize', update)
    overlay.remove()
  }
}
