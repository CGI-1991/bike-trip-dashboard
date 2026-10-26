/** Visibility only: no recalculation, no change to pauses, POIs or ETA. */
export function applyTimelineFilter(container: HTMLElement, value: string): void {
  for (const button of container.querySelectorAll<HTMLElement>('[data-timeline-filter]')) button.setAttribute('aria-pressed',String(button.dataset.timelineFilter===value))
  const servicePanel=container.querySelector<HTMLElement>('[data-timeline-services]')
  if(servicePanel)servicePanel.hidden=value!=='services'
  for(const row of container.querySelectorAll<HTMLElement>('.day-detail__timeline > li')) {
    const endpoint=row.dataset.waypointKind==='start'||row.dataset.waypointKind==='end'
    const climb=row.dataset.waypointKind==='race-segment'||row.querySelector('[data-climb-id]')!==null
    const pause=row.querySelector('.pause-clock')!==null
    row.hidden=value==='services'||!(value==='all'||endpoint||(value==='climbs'&&climb)||(value==='pauses'&&pause))
  }
}
