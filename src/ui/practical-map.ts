import L from 'leaflet'

import type { PracticalData, PracticalIconKey, PracticalLayer, PracticalPoint } from '../practical/model.ts'
import { buildGoogleMapsBicyclingUrl, getPracticalLayersForDay } from './practical-map-model.ts'
import type { PracticalLayerViewModel } from './practical-map-model.ts'

const panelControllers = new WeakMap<HTMLDialogElement, AbortController>()
const activeGroups = new WeakMap<HTMLDialogElement, ReadonlyMap<string, L.LayerGroup>>()

const iconSymbols: Readonly<Record<PracticalIconKey, string>> = {
  shelter: '⌂',
  bakery: 'B',
  cafe: 'C',
  water: 'E',
  food: 'R',
  bicycle: 'V',
  grocery: 'S',
  toilet: 'WC',
  generic: '•',
}

function createPracticalIcon(layer: PracticalLayer): L.DivIcon {
  const symbol = iconSymbols[layer.iconKey]
  const html = `<span class="practical-marker__surface" style="--practical-color:${layer.color}"><span aria-hidden="true">${symbol}</span></span>`
  return L.divIcon({
    html,
    className: `practical-marker practical-marker--${layer.iconKey}`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
  })
}

function createPopup(point: PracticalPoint, layer: PracticalLayer): HTMLElement {
  const popup = document.createElement('div')
  popup.className = 'practical-popup'
  const title = document.createElement('strong')
  title.textContent = point.name
  const layerLabel = document.createElement('span')
  layerLabel.className = 'practical-popup__layer'
  layerLabel.textContent = layer.name
  popup.append(title, layerLabel)
  if (point.description !== undefined) {
    const description = document.createElement('p')
    description.textContent = point.description
    popup.appendChild(description)
  }
  const link = document.createElement('a')
  link.className = 'button button--primary'
  link.href = buildGoogleMapsBicyclingUrl(point)
  link.target = '_blank'
  link.rel = 'noopener noreferrer'
  link.textContent = 'Itinéraire vélo'
  const note = document.createElement('small')
  note.textContent = 'Service externe · connexion requise pour le guidage.'
  popup.append(link, note)
  return popup
}

function createLayerGroup(viewModel: PracticalLayerViewModel): L.LayerGroup {
  const icon = createPracticalIcon(viewModel.layer)
  return L.layerGroup(
    viewModel.points.map((point) =>
      L.marker([point.latitude, point.longitude], { icon })
        .bindTooltip(point.name)
        .bindPopup(createPopup(point, viewModel.layer)),
    ),
  )
}

function hidePanel(
  panel: HTMLElement,
  toggle: HTMLButtonElement,
  restoreFocus = true,
): void {
  panel.hidden = true
  toggle.setAttribute('aria-expanded', 'false')
  if (restoreFocus) toggle.focus()
}

export function disposePracticalLayerPanel(dialog: HTMLDialogElement): void {
  panelControllers.get(dialog)?.abort()
  panelControllers.delete(dialog)
  const groups = activeGroups.get(dialog)
  if (groups !== undefined) {
    for (const group of groups.values()) group.remove()
  }
  activeGroups.delete(dialog)
}

export function installPracticalLayerPanel(
  dialog: HTMLDialogElement,
  map: L.Map,
  data: PracticalData | null,
  dayId: string,
): void {
  disposePracticalLayerPanel(dialog)
  const controller = new AbortController()
  panelControllers.set(dialog, controller)
  const { signal } = controller
  const toggle = dialog.querySelector<HTMLButtonElement>('[data-practical-layers-toggle]')
  const panel = dialog.querySelector<HTMLElement>('[data-practical-layers-panel]')
  const list = dialog.querySelector<HTMLElement>('[data-practical-layers-list]')
  const close = dialog.querySelector<HTMLButtonElement>('[data-practical-layers-close]')
  const hideAll = dialog.querySelector<HTMLButtonElement>('[data-practical-layers-hide-all]')
  if (toggle === null || panel === null || list === null || close === null || hideAll === null) {
    throw new Error('Panneau de calques pratiques incomplet.')
  }

  const layerViews = getPracticalLayersForDay(data, dayId)
  toggle.hidden = layerViews.length === 0
  panel.hidden = true
  toggle.setAttribute('aria-expanded', 'false')
  list.replaceChildren()
  const groups = new Map<string, L.LayerGroup>()
  activeGroups.set(dialog, groups)

  for (const viewModel of layerViews) {
    const label = document.createElement('label')
    label.className = 'practical-layer-option'
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.dataset.practicalLayer = viewModel.layer.id
    const symbol = document.createElement('span')
    symbol.className = 'practical-layer-option__symbol'
    symbol.style.setProperty('--practical-color', viewModel.layer.color)
    symbol.textContent = iconSymbols[viewModel.layer.iconKey]
    symbol.setAttribute('aria-hidden', 'true')
    const name = document.createElement('span')
    name.className = 'practical-layer-option__name'
    name.textContent = viewModel.layer.name
    const count = document.createElement('span')
    count.className = 'practical-layer-option__count'
    count.textContent = `${viewModel.points.length}`
    label.append(input, symbol, name, count)
    list.appendChild(label)

    input.addEventListener('change', () => {
      let group = groups.get(viewModel.layer.id)
      if (input.checked) {
        if (group === undefined) {
          group = createLayerGroup(viewModel)
          groups.set(viewModel.layer.id, group)
        }
        group.addTo(map)
      } else {
        group?.remove()
      }
    }, { signal })
  }

  toggle.addEventListener('click', () => {
    const opening = panel.hidden
    panel.hidden = !opening
    toggle.setAttribute('aria-expanded', String(opening))
    if (opening) list.querySelector<HTMLInputElement>('input')?.focus()
  }, { signal })
  close.addEventListener('click', () => hidePanel(panel, toggle), { signal })
  hideAll.addEventListener('click', () => {
    for (const input of list.querySelectorAll<HTMLInputElement>('input')) input.checked = false
    for (const group of groups.values()) group.remove()
  }, { signal })
  dialog.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || panel.hidden) return
    event.preventDefault()
    event.stopPropagation()
    hidePanel(panel, toggle)
  }, { signal })
}
