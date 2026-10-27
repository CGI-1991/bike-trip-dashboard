/** Trip+ by CGi — attribution of the application's original idea and design. */
export const CREATOR_STORY = 'Trip+ a été imaginée et conçue par CGi pour faciliter les voyages en itinérance, à vélo comme à pied. Au fil des besoins, elle est devenue une application multifonction, également adaptée aux courses à étapes et à l’organisation de saisons de course.'

export function renderCreatorWordmark(): string {
  return '<button class="app-wordmark" type="button" data-creator-credit aria-haspopup="dialog" aria-label="Trip+ by CGi : à propos de sa conception"><span class="app-wordmark__name">Trip<span>+</span></span><span class="app-wordmark__credit">by CGi</span></button>'
}

/** One shared native dialog; opening this credit never reads or writes trips. */
export function initializeCreatorCredit(documentRef: Document = document): { destroy(): void } {
  const dialog = documentRef.createElement('dialog')
  dialog.className = 'creator-credit-dialog'
  dialog.setAttribute('aria-labelledby', 'creator-credit-title')
  dialog.setAttribute('aria-describedby', 'creator-credit-story')
  dialog.innerHTML = '<h2 id="creator-credit-title">À l’origine de Trip+</h2><p id="creator-credit-story"></p><form method="dialog"><button class="button button--quiet" autofocus>Fermer</button></form>'
  dialog.querySelector('#creator-credit-story')!.textContent = CREATOR_STORY
  documentRef.body.append(dialog)
  const controller = new AbortController()
  let trigger: HTMLElement | null = null
  documentRef.addEventListener('click', event => {
    if (!(event.target instanceof Element)) return
    const credit = event.target.closest<HTMLElement>('[data-creator-credit]')
    if (credit === null || dialog.open) return
    trigger = credit
    dialog.showModal()
  }, { signal: controller.signal })
  dialog.addEventListener('close', () => {
    if (trigger?.isConnected) trigger.focus({ preventScroll: true })
  }, { signal: controller.signal })
  return { destroy() { controller.abort(); dialog.remove() } }
}
