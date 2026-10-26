const paths: Record<string,string> = {
  map:'<path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2zM9 3v16m6-14v16"/>',
  stages:'<path d="M8 5h13M8 12h13M8 19h13"/><circle cx="3" cy="5" r="1"/><circle cx="3" cy="12" r="1"/><circle cx="3" cy="19" r="1"/>',
  activities:'<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 3v18m4-13h4m-4 5h4"/>',
}
export function tripIcon(name: keyof typeof paths): string { return `<svg class="trip-icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] ?? ''}</svg>` }
