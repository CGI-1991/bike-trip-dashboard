export interface GpxShareTarget {
  readonly url: string
  readonly filename: string
}

interface ShareCapableNavigator {
  readonly canShare?: (data: { readonly files: File[] }) => boolean
  readonly share?: (data: { readonly files: File[]; readonly title?: string }) => Promise<void>
}

interface DownloadAnchor {
  href: string
  download: string
  rel: string
  click(): void
  remove(): void
}

interface DownloadDocument {
  createElement(tagName: 'a'): DownloadAnchor
  readonly body: { append(node: DownloadAnchor): void }
}

interface ObjectUrlFactory {
  createObjectURL(blob: Blob): string
  revokeObjectURL(url: string): void
}

export function renderGpxShareDialog(): string {
  return `<dialog class="gpx-share" id="gpx-share-dialog" aria-labelledby="gpx-share-title"><form method="dialog"><header><div><p class="eyebrow">Trace GPX</p><h2 id="gpx-share-title">GPX de l’étape</h2></div><button class="button button--quiet" type="button" data-gpx-share-close>Fermer</button></header><p role="status" aria-live="polite" data-gpx-share-status></p><div class="gpx-share__actions"><button class="button button--primary button--full" type="button" data-gpx-share-action>Partager / enregistrer</button><button class="button button--quiet button--full" type="button" data-gpx-direct-download>Télécharger</button></div></form></dialog>`
}

async function fetchGpxFile(target: GpxShareTarget): Promise<File> {
  const response = await fetch(target.url)
  if (!response.ok) {
    throw new Error(`GPX indisponible (${response.status}).`)
  }
  const blob = await response.blob()
  return new File([blob], target.filename, { type: 'application/gpx+xml' })
}

function downloadBlob(
  blob: Blob,
  filename: string,
  documentRef: DownloadDocument = document as unknown as DownloadDocument,
  objectUrls: ObjectUrlFactory = URL,
): void {
  const objectUrl = objectUrls.createObjectURL(blob)
  const link = documentRef.createElement('a')
  link.href = objectUrl
  link.download = filename
  link.rel = 'noopener'
  documentRef.body.append(link)
  link.click()
  link.remove()
  const timer: unknown = setTimeout(() => objectUrls.revokeObjectURL(objectUrl), 1_000)
  // Node's timer (unlike the browser's) keeps the event loop alive unless
  // unref'd — harmless in the browser, but without this a test or script
  // driving this code under Node hangs for the full delay.
  if (typeof timer === 'object' && timer !== null && 'unref' in timer && typeof timer.unref === 'function') timer.unref()
}

export async function downloadGpx(
  target: GpxShareTarget,
  documentRef: DownloadDocument = document as unknown as DownloadDocument,
): Promise<void> {
  const file = await fetchGpxFile(target)
  downloadBlob(file, target.filename, documentRef)
}

export async function shareGpx(
  target: GpxShareTarget,
  shareNavigator: ShareCapableNavigator | undefined = navigator,
  documentRef: DownloadDocument = document as unknown as DownloadDocument,
): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = await fetchGpxFile(target)
  const canShareFiles = shareNavigator?.canShare?.({ files: [file] }) === true

  if (canShareFiles && shareNavigator?.share !== undefined) {
    try {
      await shareNavigator.share({ files: [file], title: target.filename })
      return 'shared'
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return 'cancelled'
      }
      // Any other share failure falls back to a direct download instead of
      // surfacing an alarming error for something the fallback can still do.
    }
  }

  downloadBlob(file, target.filename, documentRef)
  return 'downloaded'
}
