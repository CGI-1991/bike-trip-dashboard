/** One structural or referential problem found while validating a value. */
export interface ValidationIssue {
  readonly path: string
  readonly code: string
  readonly message: string
}

export type ValidationResult<T> =
  | {
      readonly ok: true
      readonly value: T
    }
  | {
      readonly ok: false
      readonly issues: readonly ValidationIssue[]
    }
