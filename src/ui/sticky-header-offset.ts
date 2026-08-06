/**
 * Keeps a CSS custom property equal to a sticky header's real, live-measured
 * height (CDC Jalon B4.4 sections 12-13). Replaces the previous fixed-px
 * guesses (`--day-sticky-identity-h: 40px`, `--day-sticky-nav-h: 48px`),
 * which broke as soon as the identity line wrapped to two rows — there is no
 * "approximate" height any more, only the header's actual `getBoundingClientRect()`.
 *
 * Falls back to a single synchronous measurement when `ResizeObserver` isn't
 * available (older browsers, most test environments): the offset is still
 * correct at mount time, it just won't track later layout changes (a font
 * finishing loading, an orientation change without a resize event, etc.).
 */

export interface StickyHeaderObserverHandle {
  readonly destroy: () => void
}

export function observeStickyHeaderHeight(header: HTMLElement, cssTarget: HTMLElement, cssVarName: string): StickyHeaderObserverHandle {
  const apply = (): void => cssTarget.style.setProperty(cssVarName, `${header.getBoundingClientRect().height}px`)
  apply()

  const ResizeObserverCtor = (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver
  if (ResizeObserverCtor === undefined) return { destroy: () => undefined }

  const observer = new ResizeObserverCtor(apply)
  observer.observe(header)
  return { destroy: () => observer.disconnect() }
}
