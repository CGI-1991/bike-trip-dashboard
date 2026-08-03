/**
 * Pure "can the user create the trip yet" gate (annexe fonctionnelle
 * section 2, CDC phase 6C1 section 18). Continuity/similarity warnings are
 * deliberately never inputs here — only a strict duplicate, an invalid
 * file, or a missing required field ever disables creation.
 */

export interface WizardFileSummary {
  readonly fileName: string
  readonly status: 'valid' | 'invalid'
  /** True while this file is still part of an unresolved strict-duplicate group. */
  readonly isUnresolvedStrictDuplicate: boolean
  readonly removed: boolean
}

export interface WizardFormInput {
  readonly name: string
  readonly startDate: string | null
  readonly files: readonly WizardFileSummary[]
}

export interface WizardValidationResult {
  readonly canCreate: boolean
  readonly reasons: readonly string[]
}

export function validateWizardForm(input: WizardFormInput): WizardValidationResult {
  const reasons: string[] = []

  if (input.name.trim() === '') {
    reasons.push('Le nom du voyage est requis.')
  }
  if (input.startDate === null || input.startDate.trim() === '') {
    reasons.push('La date de départ est requise.')
  }

  const activeFiles = input.files.filter((file) => !file.removed)
  const validFiles = activeFiles.filter((file) => file.status === 'valid')
  if (validFiles.length === 0) {
    reasons.push('Au moins un fichier GPX valide est requis.')
  }

  const unresolvedDuplicates = activeFiles.filter((file) => file.isUnresolvedStrictDuplicate)
  if (unresolvedDuplicates.length > 0) {
    reasons.push('Retirez les doublons stricts avant de continuer.')
  }

  return { canCreate: reasons.length === 0, reasons }
}
