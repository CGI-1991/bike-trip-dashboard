import type { Climb, RideStage } from '../../trip-core/index.ts'
import type { RaceCourse } from '../../analysis/race-bounds.ts'
import { routeClimbs } from '../../analysis/race-segment-waypoints.ts'
import { getRouteMarkerStyle } from '../route-marker-style.ts'

export function paintRouteClimbs(profile: HTMLElement, stage: RideStage, climbs: readonly Climb[], course: RaceCourse): void {
  const svg=profile.querySelector<SVGSVGElement>('[data-profile-interactive]')
  if(!svg||typeof svg.querySelector!=='function')return
  svg.querySelector('[data-route-climb-profile]')?.remove()
  const line=svg.querySelector('.profile-line'), area=svg.querySelector('.profile-area')
  if(!line||!area)return
  const colour=getRouteMarkerStyle('col-summit').colorHex
  const escape=(v:string)=>v.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;')
  line.insertAdjacentHTML('afterend',`<g data-route-climb-profile pointer-events="none"><defs><path id="route-climb-area" d="${escape(area.getAttribute('d')??'')}"/><path id="route-climb-line" d="${escape(line.getAttribute('d')??'')}"/></defs>${routeClimbs(stage,climbs,course).map((climb,i)=>{
    const start=Math.max(0,climb.startDistanceKm), end=Math.min(course.indexed.lengthKm,climb.endDistanceKm)
    return `<g data-profile-climb="${escape(climb.id)}"><clipPath id="route-climb-clip-${i}"><rect x="${20+760*start/course.indexed.lengthKm}" y="25" width="${760*(end-start)/course.indexed.lengthKm}" height="189"/></clipPath><g clip-path="url(#route-climb-clip-${i})"><use href="#route-climb-area" fill="${colour}" opacity=".25"/><use href="#route-climb-line" fill="none" stroke="${colour}" stroke-width="3" vector-effect="non-scaling-stroke"/></g></g>`
  }).join('')}</g>`)
}
