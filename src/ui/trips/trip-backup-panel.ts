import { createTripBackup, prepareTripBackupRestore, restorePreparedTripBackup } from '../../backup/trip-backup.ts'
import type { BackupSummary, PreparedTripBackup } from '../../backup/trip-backup.ts'
import type { TripId } from '../../trip-core/index.ts'
import { downloadBlob } from '../gpx-share.ts'
import { renderFeatureUpdateBadge } from '../release-notes.ts'

export interface BackupShareNavigator {
  canShare?(data: { readonly files: File[] }): boolean
  share?(data: { readonly files: File[]; readonly title: string }): Promise<void>
}

export interface TripBackupPanelHandle {
  prepare(tripId?: TripId): Promise<void>
  destroy(): void
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
}

export function renderBackupSummary(summary: BackupSummary): string {
  return `<p>${summary.tripNames.length} voyage(s) · ${summary.sourceFileCount} GPX d’origine inclus</p>
    <ul class="trip-backup__names">${summary.tripNames.map(name => `<li>${escapeHtml(name)}</li>`).join('')}</ul>
    ${summary.missingSourceFileCount === 0 ? '' : `<p class="trip-backup__warning">${summary.missingSourceFileCount} GPX d’origine indisponible(s). Les données de voyage disponibles restent incluses.</p>`}`
}

export async function sharePreparedBackupFile(file: File, shareNavigator: BackupShareNavigator): Promise<'shared' | 'cancelled'> {
  // Called directly from a second, explicit tap after preparation: no
  // database read or fetch can consume iOS's transient user activation.
  if (shareNavigator.share === undefined) throw new Error('Utilisez Télécharger la sauvegarde pour enregistrer ce fichier.')
  try {
    await shareNavigator.share({ files: [file], title: 'Sauvegarde de mes voyages' })
    return 'shared'
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') return 'cancelled'
    throw new Error('Le partage n’a pas abouti. Utilisez Télécharger la sauvegarde.')
  }
}

export function createTripBackupPanel(container: HTMLElement, deps: {
  readonly database: IDBDatabase
  readonly now: () => string
  readonly idFactory: () => string
  readonly onRestored: (count: number) => void | Promise<void>
  readonly shareNavigator?: BackupShareNavigator
  readonly download?: (file: Blob, filename: string) => void
}): TripBackupPanelHandle {
  const controller = new AbortController()
  const shareNavigator = deps.shareNavigator ?? (typeof navigator === 'undefined' ? {} : navigator)
  let destroyed = false
  let busy = false
  let ready: Awaited<ReturnType<typeof createTripBackup>> | null = null
  let prepared: PreparedTripBackup | null = null
  let message = ''
  let failed = false

  function render(): void {
    if (destroyed) return
    let canShare = false
    try { canShare = ready !== null && shareNavigator.canShare?.({ files: [ready.file] }) === true } catch { /* Download remains available. */ }
    container.innerHTML = `<div class="trip-backup__heading"><h3>Sauvegarde et restauration</h3>${renderFeatureUpdateBadge('trip-backup')}</div>
      <p>Conservez vos voyages, réglages, pauses, logements et lieux dans Fichiers.</p>
      <div class="trip-backup__actions"><button class="button button--quiet" type="button" data-backup-action="prepare" ${busy ? 'disabled' : ''}>Préparer une sauvegarde complète</button>
      <button class="button button--quiet" type="button" data-backup-action="choose" ${busy ? 'disabled' : ''}>Restaurer une sauvegarde</button></div>
      <input type="file" accept=".zip,application/zip,application/x-zip-compressed" data-backup-file hidden>
      <p role="${failed ? 'alert' : 'status'}" aria-live="polite" data-backup-status ${message === '' ? 'hidden' : ''}>${escapeHtml(message)}</p>
      ${ready === null ? '' : `<section class="trip-backup__preview" aria-label="Sauvegarde prête">${renderBackupSummary(ready.summary)}<p>${(ready.file.size / 1024 / 1024).toLocaleString('fr-BE', { maximumFractionDigits: 1 })} Mio · prêt à enregistrer</p>
        <div class="trip-backup__actions">${canShare ? `<button class="button button--primary" type="button" data-backup-action="share" ${busy ? 'disabled' : ''}>Partager / enregistrer dans Fichiers</button>` : ''}<button class="button button--quiet" type="button" data-backup-action="download" ${busy ? 'disabled' : ''}>Télécharger la sauvegarde</button></div></section>`}
      ${prepared === null ? '' : `<section class="trip-backup__preview" aria-label="Vérifier avant restauration"><h4>Vérifier la sauvegarde</h4><p>Créée le ${escapeHtml(new Intl.DateTimeFormat('fr-BE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(prepared.createdAt)))}</p>${renderBackupSummary(prepared.summary)}
        <p>Les voyages seront ajoutés comme nouvelles copies. Vos voyages actuels restent conservés.</p>
        <div class="trip-backup__actions"><button class="button button--primary" type="button" data-backup-action="restore" ${busy ? 'disabled' : ''}>Restaurer ${prepared.trips.length} voyage(s)</button><button class="button button--quiet" type="button" data-backup-action="cancel" ${busy ? 'disabled' : ''}>Annuler</button></div></section>`}`
  }

  async function run(work: () => Promise<void>): Promise<void> {
    if (busy || destroyed) return
    busy = true
    failed = false
    render()
    try { await work() }
    catch (error) { failed = true; message = error instanceof Error ? error.message : 'L’opération n’a pas abouti. Vos voyages existants sont conservés.' }
    finally { busy = false; render() }
  }

  async function prepare(tripId?: TripId): Promise<void> {
    const details = container.closest<HTMLDetailsElement>('details')
    if (details !== null) details.open = true
    container.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
    message = 'Préparation de la sauvegarde…'
    await run(async () => {
      ready = null
      prepared = null
      ready = await createTripBackup(deps.database, deps.now(), tripId)
      message = 'Sauvegarde prête. Enregistrez le fichier avant de quitter cet écran.'
    })
  }

  container.addEventListener('change', event => {
    const input = event.target
    if (!(input instanceof HTMLInputElement) || !input.hasAttribute('data-backup-file') || busy) return
    const file = input.files?.[0]
    if (file === undefined) return
    message = 'Vérification de la sauvegarde…'
    void run(async () => {
      prepared = null
      ready = null
      prepared = await prepareTripBackupRestore(file)
      message = 'Sauvegarde vérifiée. Aucun voyage n’a encore été ajouté.'
    })
  }, { signal: controller.signal })

  container.addEventListener('click', event => {
    if (!(event.target instanceof Element)) return
    const button = event.target.closest<HTMLElement>('[data-backup-action]')
    if (button === null || busy) return
    const action = button.dataset.backupAction
    if (action === 'prepare') { void prepare(); return }
    if (action === 'choose') { container.querySelector<HTMLInputElement>('[data-backup-file]')?.click(); return }
    if (action === 'cancel') { prepared = null; message = 'Restauration annulée. Aucun voyage ajouté.'; render(); return }
    if (action === 'download' && ready !== null) {
      (deps.download ?? downloadBlob)(ready.file, ready.file.name)
      message = 'Téléchargement demandé. Vérifiez que le fichier est bien enregistré.'
      render()
    } else if (action === 'share' && ready !== null) {
      const file = ready.file
      // Start sharing before any awaited work or UI rebuild.
      const sharing = sharePreparedBackupFile(file, shareNavigator)
      void run(async () => { message = await sharing === 'cancelled' ? 'Enregistrement annulé ; la sauvegarde reste prête.' : 'Partage terminé. Vérifiez l’enregistrement dans Fichiers.' })
    } else if (action === 'restore' && prepared !== null) {
      const backup = prepared
      message = 'Restauration en cours…'
      void run(async () => {
        const ids = await restorePreparedTripBackup(deps.database, backup, deps.idFactory, deps.now())
        prepared = null
        if (!destroyed) await deps.onRestored(ids.length)
      })
    }
  }, { signal: controller.signal })
  render()
  return { prepare, destroy() { destroyed = true; controller.abort(); ready = null; prepared = null } }
}
