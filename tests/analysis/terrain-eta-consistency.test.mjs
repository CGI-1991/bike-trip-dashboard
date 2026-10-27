import '../storage/indexeddb/support/setup-fake-indexeddb.mjs'
import '../ui/support/dom-shim.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { travelTerrainForGeometry } from '../../src/analysis/travel-timing.ts'
import { buildDistanceIndexedSeries } from '../../src/analysis/elevation-profile.ts'
import { analyzeRouteTerrainClimbsAndTiming } from '../../src/import/gpx/route-analysis.ts'
import { recomputeStageTiming } from '../../src/trips-manager/stage-timing.ts'
import { computeStageWaypoints, computeStageTimingCurve } from '../../src/analysis/waypoint-timeline.ts'
import { REFERENCE_SPEED_PRESETS } from '../../src/trip-core/index.ts'
import { buildRaceCourse, applyRaceBounds } from '../../src/analysis/race-bounds.ts'
import { buildDayDetail } from '../../src/ui/trips/day-detail-view.ts'
import { buildRideDayWeatherDefinition } from '../../src/weather/generic/sample-points.ts'
import { createGenericTripBundle } from '../trip-core/support/generic-trip-fixture.mjs'
import { createLinkedTripBundle } from '../trips-manager/support/linked-trip-fixture.mjs'
import { updateTripPreferences } from '../../src/trips-manager/trip-preferences.ts'
import { createTripRepository } from '../../src/storage/indexeddb/trip-repository.ts'
import { openImportTestDatabase, createIdFactory, fixedNow } from '../import/gpx/support/run-import.mjs'

const close=(actual,expected,tolerance=.501)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} != ${expected}`)
function fixture(mode='cycling',quality='complete',flat=false){
  const bundle=createGenericTripBundle()
  const geometry=Array.from({length:1001},(_,i)=>({latitude:45+i*.0002,longitude:6+(flat?0:.002*Math.sin(i/23)),altitudeM:quality==='missing'||quality==='insufficient'&&i%10!==0||quality==='patchy'&&i%3===0?null:200+(flat?0:60*Math.sin(i/25)+i*.2)}))
  const distance=buildDistanceIndexedSeries(geometry.map(p=>({...p,elevationM:p.altitudeM}))).at(-1).distanceKm
  const route={...bundle.routes[0],geometry:{full:geometry,simplified:null}}
  const stage={...bundle.stages[0],distanceKm:distance,climbIds:[],routePointIds:[],pauseDurationSeconds:0}
  bundle.routes=[route];bundle.stages=[stage];bundle.climbs=[];bundle.routePoints=[]
  bundle.settings={...bundle.settings,global:{...bundle.settings.global,travelMode:mode,referenceSpeedKph:REFERENCE_SPEED_PRESETS[mode].normal},stages:[],days:[{dayId:stage.dayId,departureTime:'08:00',totalBreakSeconds:0}]}
  return {bundle,geometry,route,stage,distance}
}
const input=(b,speed=b.settings.global.referenceSpeedKph)=>({stage:b.stages[0],route:b.routes[0],routePoints:b.routePoints,climbs:b.climbs,manualPauses:[],automaticPausesAllowed:false,settings:{referenceSpeedKph:speed,travelMode:b.settings.global.travelMode,departureTime:'08:00'}})

for(const mode of ['cycling','walking'])test(`${mode}: all five paces and manual speed agree at import, recomputation, profile, points and weather across altitude coverage`,()=>{
  for(const quality of ['complete','patchy','insufficient','missing']){
    const {bundle,geometry,route,stage,distance}=fixture(mode,quality)
    const original=structuredClone(bundle),durations=[]
    for(const speed of [...Object.values(REFERENCE_SPEED_PRESETS[mode]),mode==='cycling'?21.3:4.2]){
      let serial=0
      const imported=analyzeRouteTerrainClimbsAndTiming({points:geometry.map(p=>({...p,elevationM:p.altitudeM})),distanceKm:distance,elevationGainM:1000,waypoints:[]},route.id,()=>`climb-${serial++}`,'test',{referenceSpeedKph:speed,travelMode:mode,departureTime:'08:00',totalBreakMinutes:0},'terrain.gpx')
      const updated=recomputeStageTiming(bundle,stage,speed,0)
      assert.equal(updated.movingDurationSeconds,imported.timing.movingDurationSeconds)
      const b={...bundle,stages:[updated],settings:{...bundle.settings,global:{...bundle.settings.global,referenceSpeedKph:speed}}}
      const curve=computeStageTimingCurve(input(b)),points=computeStageWaypoints(input(b)),end=points.at(-1)
      close(curve.elapsedMinutesAt(end.trackDistanceKm)*60,updated.movingDurationSeconds)
      close(end.elapsedMinutes*60,updated.movingDurationSeconds)
      assert.equal(end.clockTime,curve.clockTimeAt(end.trackDistanceKm))
      const weather=buildRideDayWeatherDefinition(b,b.days[0])
      for(const point of weather.samplePoints)close(point.eta.totalMinutesFromDeparture,curve.elapsedMinutesAt(point.trackDistanceKm),1e-8)
      const flatFallback=['missing','insufficient'].includes(quality)
      assert.equal(travelTerrainForGeometry(geometry,mode).profile===null,flatFallback)
      assert.equal(buildDayDetail(b,b.days[0].id).statsHtml.includes('data-flat-timing-estimate'),flatFallback)
      if(flatFallback)close(updated.movingDurationSeconds,distance/speed*3600)
      durations.push(updated.movingDurationSeconds)
    }
    for(let i=1;i<5;i++)assert.ok(durations[i]<durations[i-1],'each faster preset reduces the actual terrain duration')
    assert.deepEqual(bundle,original)
  }
})

test('Normal stays at 18 km/h cycling and 4.5 km/h walking on level terrain; model caches distinguish sport and replaced geometry',()=>{
  for(const mode of ['cycling','walking']){
    const {geometry,distance,bundle}=fixture(mode,'complete',true),speed=REFERENCE_SPEED_PRESETS[mode].normal
    const terrain=travelTerrainForGeometry(geometry,mode)
    assert.equal(terrain,travelTerrainForGeometry(geometry,mode))
    assert.notEqual(terrain,travelTerrainForGeometry(geometry,mode==='cycling'?'walking':'cycling'))
    close(computeStageWaypoints(input(bundle)).at(-1).elapsedMinutes,distance/speed*60,1e-8)
    const changed=geometry.map((p,i)=>({...p,altitudeM:200+i*3}))
    assert.notEqual(travelTerrainForGeometry(changed,mode),terrain)
    assert.ok(travelTerrainForGeometry(changed,mode).profile.some(p=>p.smoothedGradePercent>0))
  }
})

test('the displayed moving average excludes explicit pauses instead of confusing them with reference speed',()=>{
  const {bundle}=fixture('cycling','complete',true),stage=bundle.stages[0]
  const baseline=buildDayDetail(bundle,stage.dayId)
  const paused={...bundle,stages:[{...stage,pauseDurationSeconds:1200}],settings:{...bundle.settings,global:{...bundle.settings.global,pausePlanMode:'custom'},stages:[{stageId:stage.id,pausePlanMode:'custom',pauses:[{id:'manual',active:true,routePointId:`${stage.id}:start`,durationSeconds:1200,order:0,origin:'custom'}]}]}}
  const detail=buildDayDetail(paused,stage.dayId)
  for(const d of [baseline,detail])assert.match(d.statsHtml,/data-stage-moving-speed>18,0 km\/h/)
  close(detail.waypoints.at(-1).elapsedMinutes-baseline.waypoints.at(-1).elapsedMinutes,20,1e-8)
  assert.equal(detail.waypoints[0].pauseDurationMinutes,20)
})

test('race average excludes the slower approach, while clock and weather keep GPX departure',()=>{
  const {bundle}=fixture('cycling','complete',true)
  const b={...bundle,settings:{...bundle.settings,global:{...bundle.settings.global,organizationMode:'tour',raceMode:true}}},stage=b.stages[0],course=buildRaceCourse(b,stage)
  const bounded=applyRaceBounds(b,stage.id,{routeFingerprint:course.fingerprint,startOffsetM:1000,finishOffsetM:4000},course.fingerprint,'2028-05-01T08:00:00Z')
  const detail=buildDayDetail(bounded,stage.dayId)
  assert.match(detail.statsHtml,/data-stage-moving-speed>18,0 km\/h/)
  assert.equal(detail.timingCurve.clockTimeAt(0),'08:00')
  assert.ok(detail.timingCurve.elapsedMinutesAt(1)>0)
  assert.ok(detail.waypoints.find(point=>point.raceBoundary==='finish').elapsedMinutes>13)
})

test('slowing a cycling Tour adjusts a conflicting linked departure and persists the same geometry atomically',async()=>{
  const database=await openImportTestDatabase()
  try{
    const bundle=createLinkedTripBundle({rideCount:2,links:[1],referenceSpeedKph:20})
    bundle.settings.days=bundle.settings.days.map((d,i)=>({...d,departureTime:i===0?'08:00':'10:30'}))
    const repository=createTripRepository(database);await repository.saveTripBundle(bundle)
    const result=await updateTripPreferences({database,tripId:bundle.metadata.id,update:{referenceSpeedKph:8,referenceSpeedMode:'manual'},now:fixedNow('2028-05-01T08:00:00Z'),idFactory:createIdFactory('slow')})
    assert.equal(result.ok,true,result.message)
    assert.equal(result.schedule.adjustments.length,1)
    assert.equal(result.schedule.adjustments[0].to,'13:00')
    const stored=await repository.loadTripBundle(bundle.metadata.id)
    assert.equal(stored.settings.days[1].departureTime,'13:00')
    assert.deepEqual(stored.routes,bundle.routes)
    assert.deepEqual(stored.sourceFiles,bundle.sourceFiles)
    assert.equal(stored.settings.global.referenceSpeedKph,8)
  }finally{database.close()}
})
