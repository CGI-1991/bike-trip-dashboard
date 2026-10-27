const paths: Record<string,string> = {
  map:'<path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2zM9 3v16m6-14v16"/>',
  stages:'<path d="M8 5h13M8 12h13M8 19h13"/><circle cx="3" cy="5" r="1"/><circle cx="3" cy="12" r="1"/><circle cx="3" cy="19" r="1"/>',
  activities:'<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 3v18m4-13h4m-4 5h4"/>',
  link:'<path d="m10 13 4-4m-6 6-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 3 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0"/>',
  clock:'<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>',
  pending:'<circle cx="12" cy="12" r="8"/>',
  location:'<circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="1"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/>',
  edit:'<path d="m15 4 5 5M4 20l5-1L20 8a2 2 0 0 0-5-5L4 15z"/>',
  chevron:'<path d="m6 9 6 6 6-6"/>',
}
export function tripIcon(name: keyof typeof paths): string { return `<svg class="trip-icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] ?? ''}</svg>` }

export function renderInteractionCue(kind: 'edit' | 'expand'): string {
  return `<span class="interaction-cue interaction-cue--${kind}" aria-hidden="true">${tripIcon(kind === 'edit' ? 'edit' : 'chevron')}</span>`
}
