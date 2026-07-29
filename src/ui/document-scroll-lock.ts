const LOCK_CLASS = 'map-scroll-locked'
const SCROLL_X_PROPERTY = '--map-scroll-lock-x'
const SCROLL_Y_PROPERTY = '--map-scroll-lock-y'

interface ScrollLockState {
  readonly scrollX: number
  readonly scrollY: number
  references: number
}

const lockStates = new WeakMap<Document, ScrollLockState>()

export function isDocumentScrollLocked(document: Document): boolean {
  return lockStates.has(document)
}

export function lockDocumentScroll(
  document: Document = window.document,
  viewport: Window = window,
): () => void {
  const current = lockStates.get(document)
  if (current !== undefined) {
    current.references += 1
    let released = false
    return () => {
      if (released) return
      released = true
      releaseDocumentScroll(document, viewport)
    }
  }

  const state: ScrollLockState = {
    scrollX: viewport.scrollX,
    scrollY: viewport.scrollY,
    references: 1,
  }
  lockStates.set(document, state)
  document.documentElement.classList.add(LOCK_CLASS)
  document.body.classList.add(LOCK_CLASS)
  document.body.style.setProperty(SCROLL_X_PROPERTY, `${-state.scrollX}px`)
  document.body.style.setProperty(SCROLL_Y_PROPERTY, `${-state.scrollY}px`)

  let released = false
  return () => {
    if (released) return
    released = true
    releaseDocumentScroll(document, viewport)
  }
}

function releaseDocumentScroll(document: Document, viewport: Window): void {
  const state = lockStates.get(document)
  if (state === undefined) return
  state.references -= 1
  if (state.references > 0) return

  lockStates.delete(document)
  document.documentElement.classList.remove(LOCK_CLASS)
  document.body.classList.remove(LOCK_CLASS)
  document.body.style.removeProperty(SCROLL_X_PROPERTY)
  document.body.style.removeProperty(SCROLL_Y_PROPERTY)
  viewport.scrollTo(state.scrollX, state.scrollY)
}
