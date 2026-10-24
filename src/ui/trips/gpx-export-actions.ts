import type { RideStage, TripBundle } from '../../trip-core/index.ts'
import { selectRaceMode } from '../../trip-core/index.ts'
import { enrichedGpxUnavailableReason } from '../../export/enriched-gpx.ts'
import { renderFeatureUpdateBadge } from '../release-notes.ts'

export function renderStageGpxActions(bundle: TripBundle, stage: RideStage): string {
  if (!selectRaceMode(bundle)) return '<button class="button button--quiet button--full" type="button" data-action="download-stage-gpx">GPX</button>'
  const reason = enrichedGpxUnavailableReason(bundle, stage)
  return `<div class="course-exports" data-enriched-export-actions>
    <div class="course-exports__buttons"><button class="button button--quiet" type="button" data-action="download-enriched-gpx"${reason === null ? '' : ' disabled'}>GPX</button>
    <button class="button button--quiet" type="button" title="À valider sur votre Garmin" data-action="download-fit-course"${reason === null ? '' : ' disabled'}>FIT <small>essai</small></button></div>
    ${renderFeatureUpdateBadge('course-exports')}${reason === null ? '' : `<p class="field__hint">${reason}</p>`}
    <p data-enriched-export-status role="status"></p><p data-fit-export-status role="status"></p></div>`
}
