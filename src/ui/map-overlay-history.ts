type OverlayLevel = 'map' | 'layers'

interface MapOverlayHistoryState {
  readonly rgaMapOverlay?: {
    readonly token: string
    readonly level: OverlayLevel
  }
}

export interface MapOverlayHistoryOptions {
  readonly history?: History
  readonly eventTarget?: Window
  readonly isMapOpen: () => boolean
  readonly isPanelOpen: () => boolean
  readonly closePopup: () => boolean
  readonly closePanelFromHistory: () => void
  readonly closeMapFromHistory: () => void
  readonly token?: string
}

export interface MapOverlayHistoryController {
  startMap(): void
  panelOpened(): void
  panelClosedNormally(): void
  mapClosedNormally(): void
  dispose(): void
}

let nextToken = 0

export function createMapOverlayHistory(
  options: MapOverlayHistoryOptions,
): MapOverlayHistoryController {
  const history = options.history ?? window.history
  const eventTarget = options.eventTarget ?? window
  const token = options.token ?? `route-map-${Date.now()}-${nextToken += 1}`
  let listening = false
  let pendingPanelBack = false
  let pendingMapClose = false

  const ownsState = (level?: OverlayLevel): boolean => {
    const overlay = (history.state as MapOverlayHistoryState | null)?.rgaMapOverlay
    return overlay?.token === token && (level === undefined || overlay.level === level)
  }

  const push = (level: OverlayLevel): void => {
    const current = typeof history.state === 'object' && history.state !== null
      ? history.state as Record<string, unknown>
      : {}
    history.pushState({ ...current, rgaMapOverlay: { token, level } }, '')
  }

  const onPopState = (): void => {
    if (pendingPanelBack) {
      pendingPanelBack = false
      if (pendingMapClose) {
        dispose()
        history.back()
      }
      return
    }
    if (!options.isMapOpen()) {
      dispose()
      return
    }
    if (options.closePopup()) {
      push(options.isPanelOpen() ? 'layers' : 'map')
      return
    }
    if (options.isPanelOpen()) {
      options.closePanelFromHistory()
      return
    }
    dispose()
    options.closeMapFromHistory()
  }

  const listen = (): void => {
    if (listening) return
    eventTarget.addEventListener('popstate', onPopState)
    listening = true
  }

  const dispose = (): void => {
    if (!listening) return
    eventTarget.removeEventListener('popstate', onPopState)
    listening = false
  }

  return {
    startMap(): void {
      listen()
      if (!ownsState()) push('map')
    },
    panelOpened(): void {
      if (ownsState('map')) push('layers')
    },
    panelClosedNormally(): void {
      if (!ownsState('layers')) return
      pendingPanelBack = true
      history.back()
    },
    mapClosedNormally(): void {
      if (pendingPanelBack) {
        pendingMapClose = true
        return
      }
      dispose()
      if (ownsState('layers')) {
        history.go(-2)
      } else if (ownsState('map')) {
        history.back()
      }
    },
    dispose,
  }
}
