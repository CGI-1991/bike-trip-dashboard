import L from 'leaflet'
import type { OverviewStageLine } from './route-map-model.ts'
const escape=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;')

/** One real GPX line per stage. Compact maps remain an expand target. */
export function drawOverviewStages(map:L.Map,stages:readonly OverviewStageLine[],interactive:boolean):L.LatLngBounds {
  const bounds=L.latLngBounds([]), controller=new AbortController()
  const dialog=map.getContainer().closest('dialog')
  const host=dialog?.querySelector<HTMLElement>('[data-overview-stage-selection]')??null
  if(interactive)dialog?.querySelector('[data-map-layers-toggle]')?.setAttribute('aria-pressed','false')
  const lines: {line:L.Polyline;marker:L.Marker;stage:OverviewStageLine}[]=[]
  const select=(selected:OverviewStageLine|null)=>{
    for(const {line,stage,marker} of lines){const active=selected===null||stage.dayId===selected.dayId;line.setStyle({opacity:active?1:.23,weight:active?5:3});marker.setOpacity(active?1:.35);if(stage.dayId===selected?.dayId)line.bringToFront()}
    if(!host)return
    host.hidden=false
    const picker=`<label class="overview-stage-picker">Étapes<select data-overview-stage-choice aria-label="Choisir une étape sur la carte"><option value="">Tout afficher</option>${stages.map(s=>`<option value="${escape(s.dayId)}"${s.dayId===selected?.dayId?' selected':''}>${escape(s.number)} — ${escape(s.name)}</option>`).join('')}</select></label>`
    if(selected===null){host.style.setProperty('--stage-color','#163f35');host.innerHTML=picker;return}
    host.style.setProperty('--stage-color',selected.color)
    host.innerHTML=`${picker}<h3>${escape(selected.name)}</h3><p>${selected.distanceKm===null?'—':selected.distanceKm.toFixed(1).replace('.',',')+' km'} / ${selected.elevationGainM===null?'D+ —':'+'+Math.round(selected.elevationGainM)+' m'}</p><button type="button" class="button button--primary" data-action="open-day-detail" data-day-id="${escape(selected.dayId)}">Voir l’étape</button><button type="button" class="button button--quiet" data-overview-all-stages>Tout afficher</button>`
  }
  for(const stage of stages){
    const line=L.polyline(stage.coordinates.map(p=>[p[0],p[1]]),{color:stage.color,weight:4,opacity:1,interactive,className:'route-map-stage-line'}).addTo(map)
    bounds.extend(line.getBounds())
    // Halfway by distance, including uneven GPX point densities.
    const positions=stage.coordinates.map(p=>L.latLng(p[0],p[1])), distances=[0]
    for(let i=1;i<positions.length;i++)distances.push(distances[i-1]!+positions[i-1]!.distanceTo(positions[i]!))
    const middle=positions[Math.max(0,distances.findIndex(d=>d>=distances.at(-1)!/2))]!
    const marker=L.marker(middle,{interactive,icon:L.divIcon({html:`<span class="overview-stage-number__body" style="background:${stage.color}">${escape(stage.number)}</span>`,className:'overview-stage-number',iconSize:[27,27],iconAnchor:[13,13]})}).addTo(map)
    if(interactive){marker.bindTooltip(escape(stage.name),{permanent:true,direction:'top',className:'overview-stage-label'});marker.closeTooltip();line.on('click',()=>select(stage));marker.on('click',()=>select(stage));}
    lines.push({line,marker,stage})
  }
  if(interactive&&dialog){
    const toggle=dialog.querySelector<HTMLElement>('[data-map-layers-toggle]')
    const labels=()=>{for(const {marker} of lines)toggle?.getAttribute('aria-pressed')==='true'?marker.openTooltip():marker.closeTooltip()}
    map.whenReady(labels)
    // Receive the new state from the one toggle owner. A native touch event
    // may run microtasks between click listeners, before aria-pressed changes.
    map.on('overviewdetailchange',labels)
    host?.addEventListener('click',e=>{if(e.target instanceof Element&&e.target.closest('[data-overview-all-stages]'))select(null)},{signal:controller.signal})
    host?.addEventListener('change',e=>{if(e.target instanceof HTMLSelectElement&&e.target.hasAttribute('data-overview-stage-choice'))select(stages.find(s=>s.dayId===(e.target as HTMLSelectElement).value)??null)},{signal:controller.signal})
    select(null)
    map.on('remove',()=>{controller.abort();if(host){host.hidden=true;host.replaceChildren()}})
  }
  return bounds
}
