const offlineMessage = 'Mode hors ligne · données locales disponibles'

export function normalizeBaseUrl(baseUrl: string): string {
  const withLeadingSlash = baseUrl.startsWith('/') ? baseUrl : `/${baseUrl}`
  return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`
}

export function getServiceWorkerUrl(baseUrl: string): string {
  return `${normalizeBaseUrl(baseUrl)}sw.js`
}

export async function registerServiceWorker(
  baseUrl: string,
  serviceWorker: Pick<ServiceWorkerContainer, 'register'> = navigator.serviceWorker,
): Promise<ServiceWorkerRegistration> {
  const scope = normalizeBaseUrl(baseUrl)
  return serviceWorker.register(getServiceWorkerUrl(scope), {
    scope,
    updateViaCache: 'none',
  })
}

export function updateNetworkStatus(element: HTMLElement, isOnline: boolean): void {
  element.hidden = isOnline
  element.textContent = isOnline ? '' : offlineMessage
}

export function bindNetworkStatus(element: HTMLElement, target: Window = window): () => void {
  const update = (): void => updateNetworkStatus(element, target.navigator.onLine)
  target.addEventListener('online', update)
  target.addEventListener('offline', update)
  update()

  return () => {
    target.removeEventListener('online', update)
    target.removeEventListener('offline', update)
  }
}
