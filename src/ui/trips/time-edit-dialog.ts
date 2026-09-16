/**
 * The small "modifier l'heure" window: a standard `<input type="time">`,
 * Annuler and Valider.
 *
 * It exists because editing a departure time in place could not answer the
 * one question that now matters — "this time is impossible, here is the
 * first one that works". An in-page input has nowhere to say that, and its
 * only way out was to silently revert or silently save something else.
 *
 * Shaped exactly like `confirm-discard-changes.ts`: a real modal
 * `<dialog>`, built with `document.createElement`, focus-trapped and
 * Escape-dismissible by the platform, and injected through
 * `TripsManagerDeps` so the whole flow stays testable under `node --test`
 * with no DOM at all. `<input type="time">` is the platform control, so the
 * keyboard and the mobile time picker both work without a custom widget.
 */

/** What the caller knows about a proposed value. `ok: false` keeps the dialog open and explains why. */
export interface TimeEditValidation {
  readonly ok: boolean
  /** Shown inside the dialog when `ok` is `false`. */
  readonly message?: string
  /** A concrete, compatible `HH:MM` the user can adopt in one click. Never applied on their behalf. */
  readonly suggestion?: string | null
}

export interface TimeEditDialogRequest {
  readonly title: string
  readonly label: string
  /** Current `HH:MM`, pre-filled. */
  readonly value: string
  /** Optional extra line under the field (e.g. "Étape liée à J3"). */
  readonly hint?: string | null
  /** Pure, synchronous check run on Valider. Omit to accept any well-formed time. */
  readonly validate?: (value: string) => TimeEditValidation
}

/** The chosen `HH:MM`, or `null` when the user cancelled/dismissed — never a value they did not explicitly validate. */
export type TimeEditDialogResult = string | null

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

export function isWellFormedTime(value: string): boolean {
  return TIME_PATTERN.test(value)
}

export function openTimeEditDialog(request: TimeEditDialogRequest): Promise<TimeEditDialogResult> {
  if (typeof document === 'undefined') return Promise.resolve(null)
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog')
    dialog.className = 'time-edit-dialog'
    dialog.setAttribute('aria-labelledby', 'time-edit-dialog-title')
    dialog.innerHTML = `
      <h2 id="time-edit-dialog-title">${escapeHtml(request.title)}</h2>
      <div class="field">
        <label for="time-edit-dialog-input">${escapeHtml(request.label)}</label>
        <div class="field__control field__time-control"><input id="time-edit-dialog-input" type="time" data-time-edit-input value="${escapeHtml(request.value)}" required></div>
        ${request.hint === null || request.hint === undefined ? '' : `<p class="field__hint">${escapeHtml(request.hint)}</p>`}
      </div>
      <p class="time-edit-dialog__error" data-time-edit-error role="alert" hidden></p>
      <div class="time-edit-dialog__suggestion" data-time-edit-suggestion hidden>
        <button class="button button--quiet" type="button" data-time-edit-adopt></button>
      </div>
      <div class="time-edit-dialog__actions">
        <button class="button button--primary" type="button" data-time-edit-confirm>Valider</button>
        <button class="button button--quiet" type="button" data-time-edit-cancel>Annuler</button>
      </div>`

    const input = dialog.querySelector<HTMLInputElement>('[data-time-edit-input]')
    const errorElement = dialog.querySelector<HTMLElement>('[data-time-edit-error]')
    const suggestionElement = dialog.querySelector<HTMLElement>('[data-time-edit-suggestion]')
    const adoptButton = dialog.querySelector<HTMLButtonElement>('[data-time-edit-adopt]')

    let settled = false
    const finish = (result: TimeEditDialogResult): void => {
      if (settled) return
      settled = true
      dialog.close()
      dialog.remove()
      resolve(result)
    }

    const showProblem = (message: string, suggestion: string | null | undefined): void => {
      if (errorElement !== null) {
        errorElement.textContent = message
        errorElement.hidden = false
      }
      const usable = suggestion === null || suggestion === undefined ? null : suggestion
      if (suggestionElement !== null && adoptButton !== null) {
        suggestionElement.hidden = usable === null
        adoptButton.textContent = usable === null ? '' : `Utiliser ${usable}`
        adoptButton.dataset.time = usable ?? ''
      }
    }

    const clearProblem = (): void => {
      if (errorElement !== null) errorElement.hidden = true
      if (suggestionElement !== null) suggestionElement.hidden = true
    }

    const confirm = (): void => {
      const value = input?.value ?? ''
      if (!isWellFormedTime(value)) {
        showProblem('Heure invalide — utilisez le format HH:MM.', null)
        return
      }
      const validation = request.validate?.(value) ?? { ok: true }
      if (!validation.ok) {
        // Never save something the user did not type: the conflict is
        // explained here, and the compatible time is one explicit click away.
        showProblem(validation.message ?? 'Cette heure n’est pas compatible.', validation.suggestion)
        return
      }
      finish(value)
    }

    dialog.addEventListener('click', (event) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      if (target.closest('[data-time-edit-cancel]') !== null) { finish(null); return }
      if (target.closest('[data-time-edit-confirm]') !== null) { confirm(); return }
      const adopt = target.closest<HTMLElement>('[data-time-edit-adopt]')
      if (adopt !== null && input !== null) {
        const proposed = adopt.dataset.time ?? ''
        if (proposed !== '') {
          input.value = proposed
          clearProblem()
          input.focus()
        }
      }
    })
    input?.addEventListener('input', clearProblem)
    input?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); confirm() }
    })
    // Escape / any other native dismissal resolves to "changed nothing".
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); finish(null) })
    dialog.addEventListener('close', () => finish(null))

    document.body.appendChild(dialog)
    dialog.showModal()
    input?.focus()
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
