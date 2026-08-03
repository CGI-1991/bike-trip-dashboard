/**
 * `ImportJob` transitions for the GPX pipeline (CDC section 12/18):
 * `pending → parsing → validating → writing → ready`, or `→ failed` at any
 * point. Every timestamp is the caller-supplied `now`, never the real clock.
 */

import type { SourceFileId } from '../../trip-core/index.ts'
import type { ImportJob, ImportJobIssue } from '../../storage/indexeddb/import-job-repository.ts'
import type { ImportIssue } from './types.ts'

export function createInitialImportJob(id: string, now: string, engineVersion: string): ImportJob {
  return {
    id,
    tripId: null,
    createdAt: now,
    updatedAt: now,
    status: 'pending',
    currentStep: 'pending',
    progress: 0,
    sourceFileIds: [],
    issues: [],
    error: null,
    engineVersion,
  }
}

function toImportJobIssues(issues: readonly ImportIssue[]): readonly ImportJobIssue[] {
  return issues.map((issue) => ({ code: issue.code, message: issue.message }))
}

export function transitionImportJob(
  job: ImportJob,
  status: ImportJob['status'],
  now: string,
  patch: Partial<Pick<ImportJob, 'tripId' | 'sourceFileIds' | 'progress' | 'error'>> & { readonly issues?: readonly ImportIssue[] } = {},
): ImportJob {
  return {
    ...job,
    status,
    currentStep: status,
    updatedAt: now,
    tripId: patch.tripId ?? job.tripId,
    sourceFileIds: patch.sourceFileIds ?? job.sourceFileIds,
    progress: patch.progress ?? job.progress,
    error: patch.error ?? job.error,
    issues: patch.issues === undefined ? job.issues : toImportJobIssues(patch.issues),
  }
}

export function withSourceFileIds(job: ImportJob, sourceFileIds: readonly SourceFileId[]): ImportJob {
  return { ...job, sourceFileIds }
}
