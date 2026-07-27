import type { DashboardSettings } from '../storage/settings.ts'
import { rga2026TripPlan } from '../trip/plan.ts'
import type { TripPlan } from '../trip/types.ts'

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
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
          Ces valeurs restent enregistrées dans ce navigateur et s’appliquent provisoirement
          aux dix journées roulées.
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
          <label for="break-duration">Durée totale des pauses par journée roulée</label>
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

export function renderDashboard(
  settings: DashboardSettings,
  plan: TripPlan = rga2026TripPlan,
): string {
  return `
    <div class="app-shell">
      <header class="app-header">
        <div class="app-header__inner">
          <div class="brand">
            <h1>RGA 2026</h1>
            <p>Route des Grandes Alpes</p>
          </div>
          <div class="app-header__actions">
            <span class="stage-indicator" data-day-indicator>J1 sur ${plan.totalDays} · Roulé</span>
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
        <aside class="phase-notice" aria-label="Périmètre de cette version">
          <strong>Plan de voyage consolidé</strong>
          <span>12 jours calendaires, 10 journées roulées et 2 journées OFF. Météo non connectée.</span>
        </aside>

        <div class="trip-dashboard-layout">
          <section class="card trip-plan-card" aria-labelledby="trip-plan-title">
            <div class="section-heading section-heading--compact">
              <div>
                <p class="eyebrow">Chronologie réelle</p>
                <h2 id="trip-plan-title">Voyage — 12 jours</h2>
              </div>
              <span class="tag tag--data">10 roulés · 2 OFF</span>
            </div>
            <div
              class="trip-plan"
              data-trip-plan
              data-trip-state="loading"
              aria-busy="true"
            >
              <p class="trip-plan__status" role="status" aria-live="polite">
                Préparation du plan de voyage…
              </p>
            </div>
          </section>

          <section class="card route-engine-card" aria-labelledby="route-engine-title">
            <div class="section-heading section-heading--compact">
              <div>
                <p class="eyebrow">Journée sélectionnée</p>
                <h2 id="route-engine-title">Moteur d’itinéraire</h2>
              </div>
              <span class="tag tag--data">Calcul journalier</span>
            </div>
            <div
              class="route-engine"
              data-route-engine
              data-route-state="loading"
              aria-busy="true"
            >
              <p class="route-engine__message" role="status" aria-live="polite">
                En attente de l’analyse des traces GPX…
              </p>
            </div>
          </section>
        </div>

        <section class="card roadbook-detail-card" aria-labelledby="roadbook-detail-title">
          <div class="section-heading section-heading--compact">
            <div>
              <p class="eyebrow">Source métier sélectionnée</p>
              <h2 id="roadbook-detail-title">Roadbook de la journée</h2>
            </div>
            <span class="tag tag--data">Données éditoriales</span>
          </div>
          <div
            class="roadbook-detail"
            data-roadbook-detail
            data-roadbook-detail-state="loading"
            aria-busy="true"
          >
            <p role="status" aria-live="polite">Chargement du roadbook…</p>
          </div>
        </section>

        <section class="card roadbook-diagnostics-card" aria-labelledby="roadbook-diagnostics-title">
          <div class="section-heading section-heading--compact">
            <div>
              <p class="eyebrow">Contrôle provisoire</p>
              <h2 id="roadbook-diagnostics-title">Validation roadbook / GPX</h2>
            </div>
            <span class="tag tag--data">3 statuts</span>
          </div>
          <div
            class="roadbook-diagnostics"
            data-roadbook-diagnostics
            data-roadbook-diagnostic-state="loading"
            aria-busy="true"
          >
            <p role="status" aria-live="polite">Préparation du rapport d’appariement…</p>
          </div>
        </section>

        <section class="card gpx-analysis-card" aria-labelledby="gpx-analysis-title">
          <div class="section-heading section-heading--compact">
            <div>
              <p class="eyebrow">Sources géométriques</p>
              <h2 id="gpx-analysis-title">Analyse des traces GPX</h2>
            </div>
            <span class="tag tag--data">10 GPX réels</span>
          </div>
          <div
            class="gpx-analysis"
            data-gpx-analysis
            data-gpx-state="loading"
            aria-busy="true"
          >
            <p class="gpx-analysis__loading" role="status" aria-live="polite">
              Chargement et analyse des traces…
            </p>
          </div>
        </section>
      </main>

      <div class="visually-hidden" id="save-status" role="status" aria-live="polite"></div>
      ${renderSettingsDialog(settings)}
    </div>`
}
