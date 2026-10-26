import { classifyClimbGrade } from '../analysis/climb-profile.ts'
import type { ClimbGradeClass } from '../analysis/climb-profile.ts'

export const GRADE_COLORS: Readonly<Record<ClimbGradeClass, string>> = {
  'descent-7-plus': '#4f7f8f', 'descent-0-7': '#7fa9a6',
  'climb-0-1': '#7fb35a', 'climb-1-4': '#c9c24a', 'climb-4-8': '#e2963a',
  'climb-8-12': '#cf4a3a', 'climb-12-plus': '#7a2a52',
}

export function profileGradeColor(gradient: number | null): string {
  return gradient === null || !Number.isFinite(gradient) ? '#c7d2cc' : GRADE_COLORS[classifyClimbGrade(gradient)]
}
