import type { RideStage, TripBundle } from '../../trip-core/index.ts'
import { selectRaceMode } from '../../trip-core/index.ts'
import { enrichedGpxUnavailableReason } from '../../export/enriched-gpx.ts'
import { renderFeatureUpdateBadge } from '../release-notes.ts'

export function renderStageGpxActions(bundle: TripBundle, stage: RideStage): string {
  if (!selectRaceMode(bundle)) return '<button class="button button--quiet button--full" type="button" data-action="download-stage-gpx">GPX</button>'
  const reason = enrichedGpxUnavailableReason(bundle, stage)
  return `<div data-enriched-export-actions><button class="button button--quiet button--full" type="button" data-action="download-stage-gpx">GPX d’origine</button>
    <div class="enriched-gpx-export"><button class="button button--quiet button--full" type="button" data-action="download-enriched-gpx"${reason === null ? '' : ' disabled'}>Exporter GPX enrichi</button>${renderFeatureUpdateBadge('enriched-gpx')}
    <p class="field__hint">${reason ?? 'Trace, limites et segments réimportables.'}</p><p data-enriched-export-status role="status"></p></div>
    <div class="enriched-gpx-export"><button class="button button--quiet button--full" type="button" data-action="download-fit-course"${reason === null ? '' : ' disabled'}>FIT Garmin · essai</button>${renderFeatureUpdateBadge('fit-course')}
    <p class="field__hint">À valider sur votre Garmin.</p><p data-fit-export-status role="status"></p></div></div>`
}
