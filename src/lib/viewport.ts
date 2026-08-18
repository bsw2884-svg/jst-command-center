const VIEWPORT_CONTENT = 'width=device-width, initial-scale=1, viewport-fit=cover'

export type ViewportDiagnostics = {
  innerWidth: number
  clientWidth: number
  scrollWidth: number
  visualViewportWidth: number | null
  screenWidth: number
  devicePixelRatio: number
  mobileBreakpoint: boolean
  widest: {
    selector: string
    rectWidth: number
    computedWidth: string
    minWidth: string
    transform: string
  }
}

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

export const readViewportDiagnostics = (): ViewportDiagnostics => {
  const widest = [...document.querySelectorAll('html, body, body *')]
    .map(element => ({ element, rect: element.getBoundingClientRect() }))
    .sort((a, b) => b.rect.width - a.rect.width)[0]
  const style = getComputedStyle(widest.element)

  return {
    innerWidth: window.innerWidth,
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    visualViewportWidth: window.visualViewport?.width ?? null,
    screenWidth: window.screen.width,
    devicePixelRatio: window.devicePixelRatio,
    mobileBreakpoint: window.matchMedia('(max-width: 600px)').matches,
    widest: {
      selector: selectorFor(widest.element),
      rectWidth: Math.round(widest.rect.width * 100) / 100,
      computedWidth: style.width,
      minWidth: style.minWidth,
      transform: style.transform,
    },
  }
}

const isIosWebKit = () => /iP(?:hone|ad|od)/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

const hasBrokenIosViewport = () => {
  const physicalWidth = window.screen.width
  return isIosWebKit() && physicalWidth > 0 && physicalWidth <= 600
    && window.innerWidth > Math.max(700, physicalWidth * 1.5)
}

const resetViewportMeta = () => {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]')
  if (!meta) return
  meta.content = 'width=device-width, initial-scale=1.01, viewport-fit=cover'
  document.documentElement.getBoundingClientRect()
  requestAnimationFrame(() => {
    meta.content = VIEWPORT_CONTENT
    document.documentElement.getBoundingClientRect()
  })
}

export const installIosViewportRecovery = () => {
  if (!isIosWebKit()) return () => undefined
  let recoveryTimer = 0
  const check = () => {
    window.clearTimeout(recoveryTimer)
    recoveryTimer = window.setTimeout(() => {
      if (hasBrokenIosViewport()) resetViewportMeta()
    }, 60)
  }
  const onVisibility = () => { if (document.visibilityState === 'visible') check() }
  window.addEventListener('pageshow', check)
  window.addEventListener('resize', check)
  window.addEventListener('orientationchange', check)
  window.visualViewport?.addEventListener('resize', check)
  document.addEventListener('visibilitychange', onVisibility)
  check()
  return () => {
    window.clearTimeout(recoveryTimer)
    window.removeEventListener('pageshow', check)
    window.removeEventListener('resize', check)
    window.removeEventListener('orientationchange', check)
    window.visualViewport?.removeEventListener('resize', check)
    document.removeEventListener('visibilitychange', onVisibility)
  }
}

export const viewportDiagnosticsEnabled = () => new URLSearchParams(location.search).get('viewportDebug') === '1'
