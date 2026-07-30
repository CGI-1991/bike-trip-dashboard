export interface ImageViewerTarget {
  readonly title: string
  readonly imageUrl: string
  readonly sourceLabel: string
}

export function renderImageViewerDialog(): string {
  return `<dialog class="image-viewer" id="image-viewer-dialog" aria-labelledby="image-viewer-title"><form method="dialog"><header><div><p class="eyebrow" data-image-viewer-source></p><h2 id="image-viewer-title" data-image-viewer-title></h2></div><button class="button button--quiet" type="button" data-image-viewer-close>Fermer</button></header><div class="image-viewer__body"><img class="image-viewer__image" data-image-viewer-image alt=""><p class="image-viewer__error" data-image-viewer-error hidden>Image indisponible. Une connexion peut être requise.</p></div><footer><a class="button button--quiet" data-image-viewer-open-external target="_blank" rel="noopener noreferrer">Ouvrir dans le navigateur</a></footer></form></dialog>`
}

export function openImageViewer(dialog: HTMLDialogElement, target: ImageViewerTarget): void {
  const titleEl = dialog.querySelector<HTMLElement>('[data-image-viewer-title]')
  const sourceEl = dialog.querySelector<HTMLElement>('[data-image-viewer-source]')
  const image = dialog.querySelector<HTMLImageElement>('[data-image-viewer-image]')
  const errorEl = dialog.querySelector<HTMLElement>('[data-image-viewer-error]')
  const link = dialog.querySelector<HTMLAnchorElement>('[data-image-viewer-open-external]')

  if (titleEl !== null) titleEl.textContent = target.title
  if (sourceEl !== null) sourceEl.textContent = target.sourceLabel
  if (link !== null) link.href = target.imageUrl
  if (errorEl !== null) errorEl.hidden = true

  if (image !== null) {
    image.hidden = false
    image.alt = `Profil du ${target.title}`
    image.onerror = () => {
      image.hidden = true
      if (errorEl !== null) errorEl.hidden = false
    }
    image.src = target.imageUrl
  }

  dialog.showModal()
}
