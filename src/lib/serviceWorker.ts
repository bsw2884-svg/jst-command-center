let registrationPromise: Promise<ServiceWorkerRegistration | null> | null = null

const canRegister = () =>
  'serviceWorker' in navigator
  && (window.isSecureContext || ['localhost', '127.0.0.1'].includes(window.location.hostname))

export const registerJstServiceWorker = () => {
  if (!canRegister()) return Promise.resolve(null)
  if (!registrationPromise) {
    registrationPromise = navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .then(async registration => {
        await registration.update().catch(() => undefined)
        return registration
      })
      .catch(cause => {
        registrationPromise = null
        console.error('JST service worker registration failed.', cause)
        return null
      })
  }
  return registrationPromise
}

export const getActiveServiceWorkerRegistration = async () => {
  const registration = await registerJstServiceWorker()
  if (!registration) throw new Error('A service worker is not available in this browser.')
  if (registration.active) return registration
  return navigator.serviceWorker.ready
}
