/**
 * DER-DES-DER section 57 — the three-way "vous avez des modifications non
 * enregistrées" prompt.
 *
 * A native `window.confirm` can only ask a yes/no question, and the honest
 * answer here has three branches: save and go, drop the changes and go, or
 * stay put. Squeezing that into two would force the visitor to lose work to
 * find out what the second button did. So this is a real `<dialog>` — modal,
 * focus-trapped by the platform, dismissible with Escape (which maps to the
 * safe answer, "Rester").
 *
 * Kept out of `trips-manager.ts` and injected through
 * `TripsManagerDeps.confirmDiscardChanges` so the whole guard flow stays
 * testable under `node --test` with no DOM at all.
 */

import type { EditGuardDecision } from './edit-guard.ts'

export function defaultConfirmDiscardChanges(): Promise<EditGuardDecision> {
  if (typeof document === 'undefined') return Promise.resolve('stay')
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog')
    dialog.className = 'discard-changes-dialog'
    dialog.setAttribute('aria-labelledby', 'discard-changes-title')
    dialog.innerHTML = `
      <h2 id="discard-changes-title">Modifications non enregistrées</h2>
      <p>Que voulez-vous faire de vos modifications ?</p>
      <div class="discard-changes-dialog__actions">
        <button class="button button--primary" type="button" data-decision="save">Enregistrer</button>
        <button class="button button--quiet" type="button" data-decision="discard">Abandonner</button>
        <button class="button button--quiet" type="button" data-decision="stay">Rester</button>
      </div>`

    let settled = false
    const finish = (decision: EditGuardDecision): void => {
      if (settled) return
      settled = true
      dialog.close()
      dialog.remove()
      resolve(decision)
    }

    dialog.addEventListener('click', (event) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      const decision = target.closest<HTMLElement>('[data-decision]')?.dataset.decision
      if (decision === 'save' || decision === 'discard' || decision === 'stay') finish(decision)
    })
    // Escape / any other native dismissal resolves to the safe answer: keep
    // the panel and everything typed into it (section 60).
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault()
      finish('stay')
    })
    dialog.addEventListener('close', () => finish('stay'))

    document.body.appendChild(dialog)
    dialog.showModal()
    dialog.querySelector<HTMLButtonElement>('[data-decision="save"]')?.focus()
  })
}
