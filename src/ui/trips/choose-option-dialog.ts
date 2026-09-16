/**
 * A tiny "pick one" window, for the rare case where the honest answer has
 * more than two branches and `window.confirm` cannot ask it.
 *
 * It exists for one situation today: linking two stages onto the same day
 * when both already carry a different lodging. Keeping one and discarding
 * the other is a real choice, and making it silently would throw away a
 * booking the traveller entered by hand.
 *
 * Same modal shell and the same injection seam as
 * `confirm-discard-changes.ts` / `time-edit-dialog.ts`, so the whole flow
 * stays testable under `node --test` with no DOM.
 */

export interface ChooseOptionRequest {
  readonly title: string
  readonly message: string
  readonly options: readonly { readonly value: string; readonly label: string }[]
}

/** The chosen value, or `null` when the user dismissed the window — which callers must treat as "change nothing". */
export type ChooseOptionResult = string | null

export function openChooseOptionDialog(request: ChooseOptionRequest): Promise<ChooseOptionResult> {
  if (typeof document === 'undefined') return Promise.resolve(null)
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog')
    dialog.className = 'choose-option-dialog'
    dialog.setAttribute('aria-labelledby', 'choose-option-dialog-title')
    dialog.innerHTML = `
      <h2 id="choose-option-dialog-title">${escapeHtml(request.title)}</h2>
      <p>${escapeHtml(request.message)}</p>
      <div class="choose-option-dialog__actions">
        ${request.options.map((option) => `<button class="button button--primary" type="button" data-choose-value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</button>`).join('')}
        <button class="button button--quiet" type="button" data-choose-cancel>Annuler</button>
      </div>`

    let settled = false
    const finish = (result: ChooseOptionResult): void => {
      if (settled) return
      settled = true
      dialog.close()
      dialog.remove()
      resolve(result)
    }

    dialog.addEventListener('click', (event) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      if (target.closest('[data-choose-cancel]') !== null) { finish(null); return }
      const chosen = target.closest<HTMLElement>('[data-choose-value]')
      if (chosen !== null) finish(chosen.dataset.chooseValue ?? null)
    })
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); finish(null) })
    dialog.addEventListener('close', () => finish(null))

    document.body.appendChild(dialog)
    dialog.showModal()
    dialog.querySelector<HTMLButtonElement>('[data-choose-value]')?.focus()
  })
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}
