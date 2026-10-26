const controllers = new WeakMap<SVGSVGElement, AbortController>()

/** The reading lasts for the hover, finger contact, or keyboard focus. */
export function installProfileExploration(
  svg: SVGSVGElement,
  fromPointer: (event: PointerEvent) => void,
  clear: () => void,
  parentSignal?: AbortSignal,
): void {
  controllers.get(svg)?.abort()
  const controller = new AbortController()
  controllers.set(svg, controller)
  const options = { signal: controller.signal }
  parentSignal?.addEventListener('abort', () => controller.abort(), { once: true })
  let activePointer: number | null = null
  const inside = (event: PointerEvent): boolean => {
    const rect = svg.getBoundingClientRect()
    return event.clientX >= rect.left && event.clientX <= rect.left + rect.width
      && event.clientY >= rect.top && event.clientY <= rect.top + rect.height
  }
  const end = (): void => { activePointer = null; clear() }
  svg.addEventListener('pointerdown', event => {
    activePointer = event.pointerId
    svg.setPointerCapture?.(event.pointerId)
    fromPointer(event)
  }, options)
  svg.addEventListener('pointermove', event => {
    if (event.pointerType === 'touch' && event.pointerId !== activePointer) return
    if (activePointer !== null && !inside(event)) { clear(); return }
    fromPointer(event)
  }, options)
  svg.addEventListener('pointerup', event => {
    activePointer = null
    svg.releasePointerCapture?.(event.pointerId)
    if (event.pointerType !== 'mouse' || !inside(event)) clear()
  }, options)
  svg.addEventListener('pointerleave', clear, options)
  svg.addEventListener('pointercancel', end, options)
  svg.addEventListener('lostpointercapture', event => {
    if (event.pointerType !== 'mouse') end()
  }, options)
  svg.addEventListener('blur', end, options)
  svg.addEventListener('keydown', event => { if (event.key === 'Escape') end() }, options)
}
