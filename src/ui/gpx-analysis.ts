import { loadGpxAnalysis } from '../gpx/load.ts'
import type { FetchImplementation } from '../gpx/load.ts'
import type {
  GpxAnalysisError,
  GpxAnalysisReport,
  GpxAnalysisSuccess,
} from '../gpx/types.ts'

const distanceFormatter = new Intl.NumberFormat('fr-FR', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})
const elevationFormatter = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 })

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function formatFileNumber(fileNumber: number): string {
  return String(fileNumber).padStart(2, '0')
}

function formatElevation(elevationM: number | null, prefix = ''): string {
  return elevationM === null ? '—' : `${prefix}${elevationFormatter.format(elevationM)} m`
}

function renderSuccessRow(result: GpxAnalysisSuccess): string {
  const { summary } = result
  const fileNumber = formatFileNumber(summary.fileNumber)

  return `
    <li
      class="gpx-row"
      data-gpx-row
      data-gpx-number="${fileNumber}"
      data-gpx-status="success"
      data-gpx-variant="${summary.isVariant}"
    >
      <div class="gpx-row__header">
        <span class="gpx-row__number" aria-label="Trace ${fileNumber}">${fileNumber}</span>
        <span class="gpx-row__route">
          <strong>${escapeHtml(summary.startName)}</strong>
          <span class="visually-hidden">vers</span>
          <span aria-hidden="true">→</span>
          <strong>${escapeHtml(summary.endName)}</strong>
        </span>
        ${summary.isVariant ? '<span class="tag tag--variant">Variante</span>' : ''}
      </div>
      <dl class="gpx-row__metrics">
        <div>
          <dt>Distance</dt>
          <dd>${distanceFormatter.format(summary.distanceKm)} km</dd>
        </div>
        <div>
          <dt>D+</dt>
          <dd>${formatElevation(summary.elevationGainM, '+')}</dd>
        </div>
        <div>
          <dt>Altitude max.</dt>
          <dd>${formatElevation(summary.maxElevationM)}</dd>
        </div>
      </dl>
    </li>`
}

function renderErrorRow(result: GpxAnalysisError): string {
  const fileNumber = formatFileNumber(result.source.fileNumber)

  return `
    <li
      class="gpx-row gpx-row--error"
      data-gpx-row
      data-gpx-number="${fileNumber}"
      data-gpx-status="error"
    >
      <div class="gpx-row__header">
        <span class="gpx-row__number" aria-label="Trace ${fileNumber}">${fileNumber}</span>
        <span class="gpx-row__route">
          <strong>${escapeHtml(result.source.startName)}</strong>
          <span class="visually-hidden">vers</span>
          <span aria-hidden="true">→</span>
          <strong>${escapeHtml(result.source.endName)}</strong>
        </span>
        <span class="tag tag--error">Erreur</span>
      </div>
      <p class="gpx-row__error">${escapeHtml(result.message)}</p>
    </li>`
}

function renderReport(container: HTMLElement, report: GpxAnalysisReport): void {
  const fileLabel = report.successfulFileCount > 1 ? 'traces analysées' : 'trace analysée'
  const failureText =
    report.failedFileCount > 0
      ? `, ${report.failedFileCount} erreur${report.failedFileCount > 1 ? 's' : ''} isolée${report.failedFileCount > 1 ? 's' : ''}`
      : ''

  container.dataset.gpxState = report.status
  container.setAttribute('aria-busy', 'false')
  container.innerHTML = `
    <p
      class="gpx-analysis__result gpx-analysis__result--${report.status}"
      data-gpx-summary
      role="status"
      aria-live="polite"
    >
      <strong>${report.successfulFileCount} ${fileLabel}</strong>${failureText}.
    </p>
    <p class="gpx-analysis__comparison" data-gpx-comparison>
      ${report.detectedFileCount} traces GPX détectées — ${report.configuredStageCount} étapes
      configurées. Un regroupement devra être défini.
    </p>
    <ol class="gpx-list">
      ${report.files
        .map((result) =>
          result.status === 'success' ? renderSuccessRow(result) : renderErrorRow(result),
        )
        .join('')}
    </ol>
    <p class="gpx-analysis__note">
      Distances et dénivelés calculés directement sur les points GPX, sans lissage.
    </p>`
}

function renderGlobalError(container: HTMLElement, error: unknown): void {
  const message = error instanceof Error ? error.message : 'Erreur inconnue.'
  container.dataset.gpxState = 'error'
  container.setAttribute('aria-busy', 'false')
  container.innerHTML = `
    <div class="gpx-analysis__global-error" role="alert">
      <strong>Analyse GPX indisponible</strong>
      <p>${escapeHtml(message)}</p>
    </div>`
}

export async function initializeGpxAnalysis(
  container: HTMLElement,
  configuredStageCount: number,
  fetchImplementation: FetchImplementation = globalThis.fetch.bind(globalThis),
): Promise<void> {
  container.dataset.gpxState = 'loading'
  container.setAttribute('aria-busy', 'true')

  try {
    renderReport(container, await loadGpxAnalysis(configuredStageCount, fetchImplementation))
  } catch (error) {
    renderGlobalError(container, error)
  }
}
