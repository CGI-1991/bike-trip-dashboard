import type { CanonicalWaypoint } from '../../analysis/canonical-waypoints.ts'
import type { RideStage, TripBundle } from '../../trip-core/index.ts'
import type { StageTimingCurve } from '../../analysis/waypoint-timeline.ts'
import { PRACTICAL_PLACE_UX_LABELS } from '../../practical-places/taxonomy.ts'
const labels:Record<string,string>={...PRACTICAL_PLACE_UX_LABELS,'cafe-or-ice-cream':'Café','fast-food':'Restauration',sports:'Sport'}
const escape=(v:string)=>v.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')

export function renderStageServices(bundle:TripBundle,stage:RideStage,points:readonly CanonicalWaypoint[],limit=50,timingCurve?:StageTimingCurve|null):string {
  const places=bundle.practicalPlaces.filter(p=>!p.hidden&&(p.stageId===stage.id||p.stageId==null&&p.dayIds.includes(stage.dayId))).sort((a,b)=>(a.trackDistanceKm??Infinity)-(b.trackDistanceKm??Infinity))
  if(!places.length)return '<p>Aucun service enregistré pour cette étape.</p>'
  return `<ol class="timeline-services" data-services-limit="${limit}">${places.slice(0,limit).map(p=>{
    const near=p.trackDistanceKm===null?undefined:points.reduce<CanonicalWaypoint|undefined>((best,point)=>Math.abs(point.trackDistanceKm-p.trackDistanceKm!)<Math.abs((best?.trackDistanceKm??Infinity)-p.trackDistanceKm!)?point:best,undefined)
    const weather=near&&p.trackDistanceKm!==null&&Math.abs(near.trackDistanceKm-p.trackDistanceKm)<=1?`<span class="poi-weather-label">Météo proche</span><span class="day-detail__timeline-weather" data-waypoint-weather data-waypoint-id="${escape(near.id)}"></span>`:''
    const eta=p.trackDistanceKm===null?null:timingCurve?.clockTimeAt(p.trackDistanceKm)
    return `<li class="day-detail__timeline-row timeline-service"><span class="day-detail__timeline-time-col"><span class="day-detail__timeline-time">${escape(eta??'—')}</span></span><div class="day-detail__timeline-body"><strong>${escape(p.name??labels[p.category]!)}</strong><span class="day-detail__timeline-meta">${escape(labels[p.category]!)}${p.trackDistanceKm===null?'':` · ${p.trackDistanceKm.toFixed(1).replace('.',',')} km`}${p.detourKm===null?'':` · écart ${Math.round(p.detourKm*1000)} m`}</span>${p.openingHours?`<span class="day-detail__timeline-meta">${escape(p.openingHours)}</span>`:''}${weather}</div></li>`
  }).join('')}</ol>${places.length>limit?`<button type="button" class="button button--quiet" data-more-services>Afficher les 50 suivants (${Math.min(limit,places.length)} / ${places.length})</button>`:''}`
}
