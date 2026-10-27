import './support/dom-shim.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildDayDetail } from '../../src/ui/trips/day-detail-view.ts'
import { buildTripOverview } from '../../src/ui/trips/trip-overview-view.ts'
import { buildGenericOverviewRouteMapModel } from '../../src/ui/route-map-model.ts'
import { renderStageServices } from '../../src/ui/trips/stage-services.ts'
import { createGenericTripBundle } from '../trip-core/support/generic-trip-fixture.mjs'
import { stageColor } from '../../src/ui/stage-colors.ts'
import { GENERIC_APP_TITLE } from '../../src/ui/trips/app-header.ts'

test('Trip+ preserves complete statistics before its unified three/four tabs and lower day chooser',()=>{
  for(const raceMode of [false,true]){
    const base=createGenericTripBundle(),bundle={...base,settings:{...base.settings,global:{...base.settings.global,raceMode}}}
    const view=buildDayDetail(bundle,bundle.days[0].id)
    assert.equal((view.html.match(/role="tab"/g)||[]).length,raceMode?4:3)
    assert.ok(view.html.indexOf('data-day-detail-stats-card')<view.html.indexOf('data-day-detail-tabs'))
    assert.ok(view.html.indexOf('data-day-detail-tabs')<view.html.indexOf('data-day-detail-map-profile-card'))
    assert.match(view.html,/data-stage-navigation/);assert.match(view.html,/J1 — Riverside → Hilltown/)
    assert.match(view.statsHtml,/Distance/);assert.match(view.statsHtml,/Moyenne en mouvement/);assert.match(view.statsHtml,/Montées/)
  }
  assert.equal(GENERIC_APP_TITLE,'Trip+')
})

test('overview carries real, separate stage paths with saved identity, colour and names into the Leaflet model',()=>{
  const b=createGenericTripBundle(),view=buildTripOverview(b,'2027-05-10')
  const model=buildGenericOverviewRouteMapModel(view.mapStages)
  assert.ok(model.overviewStages.length>0)
  const stage=model.overviewStages[0]
  assert.equal(stage.dayId,b.stages[0].dayId);assert.equal(stage.color,stageColor(0))
  assert.match(stage.name,/Riverside/);assert.ok(stage.coordinates.length>1)
  assert.notEqual(stageColor(0),stageColor(1));assert.notEqual(stageColor(1),stageColor(2))
})

test('the services view escapes source names, excludes hidden places and only attaches nearby existing forecasts',()=>{
  const base=createGenericTripBundle(),stage=base.stages[0]
  const place={id:'service',stageId:stage.id,category:'water',name:'<script>bad</script>',hidden:false,dayIds:[stage.dayId],trackDistanceKm:2,detourKm:.01,openingHours:'24/7'}
  const bundle={...base,practicalPlaces:[place,{...place,id:'hidden',name:'Should stay hidden',hidden:true}]}
  const html=renderStageServices(bundle,stage,[{id:'near',trackDistanceKm:2.2}])
  assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>|Should stay hidden/)
  assert.match(html,/data-waypoint-id="near"/);assert.match(html,/Météo proche/)
  assert.doesNotMatch(renderStageServices(bundle,stage,[{id:'distant',trackDistanceKm:10}]),/data-waypoint-weather/)
})

test('long-route service lists render in bounded pages without dropping saved results',()=>{
  const base=createGenericTripBundle(),stage=base.stages[0]
  const places=Array.from({length:125},(_,i)=>({id:`service-${i}`,name:`Eau ${i}`,stageId:stage.id,category:'water',hidden:false,dayIds:[stage.dayId],trackDistanceKm:i/10,detourKm:0,openingHours:null}))
  const b={...base,practicalPlaces:places}
  assert.equal((renderStageServices(b,stage,[]).match(/class="day-detail__timeline-row timeline-service"/g)||[]).length,50)
  assert.match(renderStageServices(b,stage,[]),/50 \/ 125/)
  assert.equal((renderStageServices(b,stage,[],100).match(/class="day-detail__timeline-row timeline-service"/g)||[]).length,100)
  assert.doesNotMatch(renderStageServices(b,stage,[],150),/data-more-services/)
  assert.equal(b.practicalPlaces.length,125)
})
