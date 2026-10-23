import { APP_RELEASES, CURRENT_APP_VERSION } from '../releases.ts'
import type { AppRelease } from '../releases.ts'

interface ReadStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const STORAGE_PREFIX = 'bike-trip-dashboard:release-read:'
function storage(): ReadStorage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage }
  catch { return null }
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
}

export function featureReleaseKey(feature: string, releases: readonly AppRelease[] = APP_RELEASES): string | null {
  const release = releases.find(release => release.changes.some(change => change.feature === feature))
  return release === undefined ? null : `${release.version}:${feature}`
}

export function renderFeatureUpdateBadge(feature: string, readStorage: ReadStorage | null = storage()): string {
  const key = featureReleaseKey(feature)
  if (key === null) return ''
  try { if (readStorage?.getItem(`${STORAGE_PREFIX}${key}`) === 'read') return '' } catch { /* Badges work without storage. */ }
  return `<button class="feature-update-badge" type="button" data-feature-update="${escapeHtml(feature)}" data-release-note-key="${escapeHtml(key)}" aria-label="Voir ce qui a changé ici" aria-haspopup="dialog"><span>MAJ</span></button>`
}

export function renderReleaseNotes(feature?: string): string {
  const releases = APP_RELEASES.filter(release => feature === undefined || release.changes.some(change => change.feature === feature))
  return `<header><div><p class="eyebrow">Version chargée : ${escapeHtml(CURRENT_APP_VERSION)}</p><h2 id="release-notes-title">${feature === undefined ? 'Nouveautés' : 'Ce qui a changé ici'}</h2></div><button class="button button--quiet" type="button" data-release-notes-close autofocus>Fermer</button></header>
    ${releases.map(release => `<section class="release-notes__entry"><p class="release-notes__date">${new Intl.DateTimeFormat('fr-BE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Brussels' }).format(new Date(`${release.date}T12:00:00Z`))}</p><ul>${release.changes.filter(change => feature === undefined || change.feature === feature).map(change => `<li><h3>${escapeHtml(change.title)}</h3><p>${escapeHtml(change.description)}</p></li>`).join('')}</ul></section>`).join('')}`
}

/** Delegated on document so badges added later, including inside an open
 * fullscreen map, have the same touch/keyboard behaviour without remounts. */
export function initializeReleaseNotes(documentRef: Document = document, readStorage: ReadStorage | null = storage()): { destroy(): void } {
  const dialog = documentRef.createElement('dialog')
  dialog.className = 'release-notes'
  dialog.setAttribute('aria-labelledby', 'release-notes-title')
  documentRef.body.append(dialog)
  let shownKeys: readonly string[] = []
  let lastTrigger: HTMLElement | null = null
  const controller = new AbortController()
  dialog.addEventListener('close', () => {
    for (const key of shownKeys) {
      try { readStorage?.setItem(`${STORAGE_PREFIX}${key}`, 'read') } catch { /* Never affect trips. */ }
      for (const badge of documentRef.querySelectorAll<HTMLElement>('[data-release-note-key]')) {
        if (badge.dataset.releaseNoteKey === key) badge.hidden = true
      }
    }
    if (lastTrigger?.hidden) {
      const parentDialog = lastTrigger.closest<HTMLDialogElement>('dialog[open]')
      const fallback = parentDialog?.querySelector<HTMLElement>('button:not([hidden])')
        ?? documentRef.querySelector<HTMLElement>('[data-release-notes]')
      fallback?.focus()
    }
  }, { signal: controller.signal })
  documentRef.addEventListener('click', event => {
    const target = event.target
    if (!(target instanceof Element)) return
    if (target.closest('[data-release-notes-close]') !== null && dialog.contains(target)) { dialog.close(); return }
    const trigger = target.closest<HTMLElement>('[data-feature-update], [data-release-notes]')
    if (trigger === null) return
    const feature = trigger.dataset.featureUpdate
    if (feature !== undefined && featureReleaseKey(feature) === null) return
    lastTrigger = trigger
    shownKeys = APP_RELEASES.flatMap(release => release.changes.filter(change => feature === undefined || change.feature === feature).map(change => `${release.version}:${change.feature}`))
    dialog.innerHTML = renderReleaseNotes(feature)
    if (!dialog.open) dialog.showModal()
  }, { signal: controller.signal })
  return { destroy() { controller.abort(); dialog.remove() } }
}
