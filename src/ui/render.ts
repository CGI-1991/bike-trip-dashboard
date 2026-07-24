import {
  activeStageId,
  demoAlerts,
  demoStages,
  demoTimeline,
  todayDemo,
} from '../data/demo.ts'
import type { DashboardSettings } from '../storage/settings.ts'

const numberFormatter = new Intl.NumberFormat('fr-FR')

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function formatDistance(distanceKm: number): string {
  return `${numberFormatter.format(distanceKm)} km`
}

function formatElevation(elevationGainM: number): string {
  return `+${numberFormatter.format(elevationGainM)} m`
}

function renderTimeline(): string {
  return demoTimeline
    .map(
      (point, index) => `
        <li class="timeline__item">
          <span class="timeline__marker" aria-hidden="true"></span>
          <span class="timeline__position">${
            index === 0 ? 'Départ' : index === demoTimeline.length - 1 ? 'Arrivée' : `Point ${index}`
          }</span>
          <strong class="timeline__name">${escapeHtml(point.name)}</strong>
          <time class="timeline__time">${escapeHtml(point.time)}</time>
          <span class="timeline__weather">${escapeHtml(point.weather)}</span>
        </li>`,
    )
    .join('')
}

function renderAlerts(): string {
  return demoAlerts
    .map(
      (alert) => `
        <li class="alert alert--${alert.tone}">
          <div class="alert__heading">
            <strong>${escapeHtml(alert.title)}</strong>
            <span class="tag tag--alert">Fictif</span>
          </div>
          <p>${escapeHtml(alert.detail)}</p>
        </li>`,
    )
    .join('')
}

function renderStages(): string {
  return demoStages
    .map((stage) => {
      const isActive = stage.id === activeStageId
      return `
        <li class="stage-row${isActive ? ' stage-row--active' : ''}"${
          isActive ? ' aria-current="step"' : ''
        }>
          <span class="stage-row__number" aria-label="Étape ${stage.id}">${stage.id}</span>
          <span class="stage-row__route">
            <strong>${escapeHtml(stage.start)}</strong>
            <span>${escapeHtml(stage.end)}</span>
          </span>
          <span class="stage-row__stats">
            <span>${formatDistance(stage.distanceKm)}</span>
            <span>${formatElevation(stage.elevationGainM)}</span>
          </span>
        </li>`
    })
    .join('')
}

function renderSettingsDialog(settings: DashboardSettings): string {
  return `
    <dialog class="settings-dialog" id="settings-dialog" aria-labelledby="settings-title">
      <form class="settings-form" id="settings-form">
        <div class="settings-dialog__header">
          <div>
            <p class="eyebrow">Préférences locales</p>
            <h2 id="settings-title">Réglages</h2>
          </div>
          <button class="button button--quiet" type="button" data-close-settings>Fermer</button>
        </div>

        <p class="settings-dialog__intro">
          Ces valeurs sont enregistrées uniquement dans ce navigateur. Aucun calcul d’ETA réel
          n’est effectué à ce stade.
        </p>

        <div class="field">
          <label for="average-speed">Vitesse moyenne</label>
          <div class="field__control">
            <input
              id="average-speed"
              name="averageSpeedKph"
              type="number"
              min="8"
              max="40"
              step="0.5"
              inputmode="decimal"
              value="${settings.averageSpeedKph}"
              required
            />
            <span>km/h</span>
          </div>
        </div>

        <div class="field">
          <label for="departure-time">Heure de départ</label>
          <input
            id="departure-time"
            name="departureTime"
            type="time"
            value="${escapeHtml(settings.departureTime)}"
            required
          />
        </div>

        <div class="field">
          <label for="break-duration">Durée totale des pauses</label>
          <div class="field__control">
            <input
              id="break-duration"
              name="totalBreakMinutes"
              type="number"
              min="0"
              max="240"
              step="5"
              inputmode="numeric"
              value="${settings.totalBreakMinutes}"
              required
            />
            <span>minutes</span>
          </div>
        </div>

        <p class="settings-feedback" id="settings-feedback" role="status" aria-live="polite"></p>
        <button class="button button--primary button--full" type="submit">Enregistrer</button>
      </form>
    </dialog>`
}

export function renderDashboard(settings: DashboardSettings): string {
  return `
    <div class="app-shell">
      <header class="app-header">
        <div class="app-header__inner">
          <div class="brand">
            <h1>RGA 2026</h1>
            <p>Route des Grandes Alpes</p>
          </div>
          <div class="app-header__actions">
            <span class="stage-indicator">Étape ${activeStageId} sur ${demoStages.length}</span>
            <button
              class="button button--header"
              type="button"
              data-open-settings
              aria-haspopup="dialog"
              aria-controls="settings-dialog"
            >
              Réglages
            </button>
          </div>
        </div>
      </header>

      <main class="dashboard">
        <aside class="demo-notice" aria-label="Avertissement sur les données">
          <strong>Données de démonstration</strong>
          <span>Aucune heure ni météo affichée sur cette page n’est réelle.</span>
        </aside>

        <div class="dashboard__layout">
          <div class="dashboard__primary">
            <section class="card today-card" aria-labelledby="today-title">
              <div class="section-heading">
                <div>
                  <p class="eyebrow">Étape du jour</p>
                  <h2 id="today-title">Aujourd’hui</h2>
                </div>
                <span class="tag">Démonstration</span>
              </div>

              <p class="demo-date">
                <time datetime="2026-06-20">${escapeHtml(todayDemo.dateLabel)}</time>
                <span>Date fictive</span>
              </p>

              <div class="route-summary" aria-label="Trajet de démonstration">
                <div>
                  <span>Départ</span>
                  <strong>${escapeHtml(todayDemo.start)}</strong>
                </div>
                <span class="route-summary__separator" aria-hidden="true"></span>
                <div>
                  <span>Arrivée</span>
                  <strong>${escapeHtml(todayDemo.end)}</strong>
                </div>
              </div>

              <dl class="metrics">
                <div class="metric">
                  <dt>Distance</dt>
                  <dd>${formatDistance(todayDemo.distanceKm)}</dd>
                </div>
                <div class="metric">
                  <dt>Dénivelé positif</dt>
                  <dd>${formatElevation(todayDemo.elevationGainM)}</dd>
                </div>
                <div class="metric">
                  <dt>Départ prévu</dt>
                  <dd data-departure-display>${escapeHtml(settings.departureTime)}</dd>
                </div>
                <div class="metric">
                  <dt>Arrivée estimée</dt>
                  <dd>${escapeHtml(todayDemo.estimatedArrivalTime)} <small>fictive</small></dd>
                </div>
              </dl>

              <div class="weather-demo">
                <div>
                  <span>Météo fictive</span>
                  <strong>${escapeHtml(todayDemo.weatherSummary)}</strong>
                </div>
                <p>Simulation visuelle, sans connexion à un service météo.</p>
              </div>
            </section>

            <section class="card" aria-labelledby="timeline-title">
              <div class="section-heading section-heading--compact">
                <div>
                  <p class="eyebrow">Parcours simulé</p>
                  <h2 id="timeline-title">Frise de progression</h2>
                </div>
                <span class="tag">Horaires fictifs</span>
              </div>
              <ol class="timeline">
                ${renderTimeline()}
              </ol>
            </section>

            <section class="card" aria-labelledby="alerts-title">
              <div class="section-heading section-heading--compact">
                <div>
                  <p class="eyebrow">Vigilance simulée</p>
                  <h2 id="alerts-title">Alertes</h2>
                </div>
                <span class="tag">Démonstration</span>
              </div>
              <ul class="alert-list">
                ${renderAlerts()}
              </ul>
            </section>
          </div>

          <section class="card stages-card" aria-labelledby="stages-title">
            <div class="section-heading section-heading--compact">
              <div>
                <p class="eyebrow">Aperçu du voyage</p>
                <h2 id="stages-title">Étapes</h2>
              </div>
              <span class="tag">8 fictives</span>
            </div>
            <ol class="stage-list">
              ${renderStages()}
            </ol>
          </section>
        </div>
      </main>

      <div class="visually-hidden" id="save-status" role="status" aria-live="polite"></div>
      ${renderSettingsDialog(settings)}
    </div>`
}
