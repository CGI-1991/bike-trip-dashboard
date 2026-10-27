import '../storage/indexeddb/support/setup-fake-indexeddb.mjs'
import '../ui/support/dom-shim.mjs'
import { installMinimalDOMParser } from '../support/minimal-dom-parser.mjs'
installMinimalDOMParser()
import test from 'node:test'
import assert from 'node:assert/strict'
import { importGpxTrip } from '../../src/import/gpx/import-gpx-trip.ts'
import { buildGpxXml, toGpxImportFile } from '../import/gpx/support/fixtures.mjs'
import { createIdFactory, fixedNow, openImportTestDatabase } from '../import/gpx/support/run-import.mjs'
import { applyRaceBounds, buildRaceCourse, selectStageCourseMetrics } from '../../src/analysis/race-bounds.ts'
import { computeStageTimingCurve, computeStageWaypoints, neutralizedCyclingReferenceSpeed } from '../../src/analysis/waypoint-timeline.ts'
import { computeRideArrivalEta, deriveTripTemporalState } from '../../src/trips-manager/trip-day-temporal-state.ts'
import { updateRaceCourse } from '../../src/trips-manager/race-course.ts'
import { summarizeTripBundle } from '../../src/trips-manager/trip-summary.ts'
import { buildRideDayWeatherDefinition } from '../../src/weather/generic/sample-points.ts'
import { GenericWeatherCoordinator } from '../../src/weather/generic/coordinator.ts'
import { WeatherCache } from '../../src/weather/cache.ts'
import { buildRouteWindModel } from '../../src/weather/relative-wind.ts'
import { buildPracticalPlaceViewModels } from '../../src/practical-places/view-model.ts'
import { buildDayDetail } from '../../src/ui/trips/day-detail-view.ts'
import { buildTripOverview } from '../../src/ui/trips/trip-overview-view.ts'
import { renderTripDetail } from '../../src/ui/trips/trip-detail-view.ts'
import { renderLeagueCalendar } from '../../src/ui/trips/league-calendar-view.ts'
import { createGenericTripBundle } from '../trip-core/support/generic-trip-fixture.mjs'
import { createTripRepository } from '../../src/storage/indexeddb/trip-repository.ts'
import { validateTripBundle } from '../../src/trip-core/index.ts'

const NOW='2027-05-09T06:00:00.000Z'
const close=(a,b,tolerance=1e-6)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`)
async function setup({mode='league',travelMode='cycling',departureTime='08:00',altitude=true,linked=false}={}) {
  const database=await openImportTestDatabase()
  const files=[0,1].map(n=>toGpxImportFile(buildGpxXml({tracks:[{name:`Course ${n}`,segments:[Array.from({length:201},(_,i)=>({lat:45+n+i*.001,lon:6,...(altitude?{ele:i<50?200+i*10:i<150?700:700+(i-150)*5}:{})}))]}]}),`course-${n}.gpx`))
  const result=await importGpxTrip({database,files,options:{tripId:'race-timing',slug:'race-timing',name:'Courses',organizationMode:mode,travelMode,referenceSpeedKph:travelMode==='walking'?4.5:18,startDate:'2027-05-10',timezone:'Europe/Brussels',departureTime,importedAt:NOW,engineVersion:'test'},dayStructure:files.map((_,i)=>({kind:'ride',eventDate:i===0?'2027-05-10':'2027-05-12',departureTime,...(linked&&i===1?{sameCalendarDayAsPrevious:true}:{})})),idFactory:createIdFactory('course'),now:fixedNow()})
  assert.equal(result.ok,true,result.error?.message)
  return {database,bundle:result.bundle}
}
function bounded(bundle,startOffsetM=6000,finishOffsetM=14000,index=0) {
  const stage=bundle.stages[index], course=buildRaceCourse(bundle,stage)
  return applyRaceBounds(bundle,stage.id,{routeFingerprint:course.fingerprint,startOffsetM,finishOffsetM},course.fingerprint,NOW)
}
function input(bundle,index=0,scoped=true) {
  const stage=bundle.stages[index], route=bundle.routes.find(route=>route.id===stage.sourceRouteId)
  return {stage,route,routePoints:bundle.routePoints,climbs:bundle.climbs,
    settings:{referenceSpeedKph:bundle.settings.global.referenceSpeedKph,travelMode:bundle.settings.global.travelMode,departureTime:bundle.settings.days.find(day=>day.dayId===stage.dayId).departureTime},
    manualPauses:[],automaticPausesAllowed:false,...(scoped?{raceCourse:buildRaceCourse(bundle,stage)}:{})}
}
function forecast(request) {
  return {provider:'open-meteo',requestKey:request.key,fetchedAt:NOW,status:'success',datesCovered:request.requiredDates,issues:[],locations:request.locations.map(location=>({
    status:'success',requestLocationId:location.id,requestedLatitude:location.latitude,requestedLongitude:location.longitude,requestedElevationM:location.elevationM,providerLatitude:location.latitude,providerLongitude:location.longitude,providerElevationM:location.elevationM,timezone:request.timezone,utcOffsetSeconds:7200,missingVariables:[],issues:[],
    hourly:request.requiredDates.flatMap(date=>Array.from({length:24},(_,h)=>({time:`${date}T${String(h).padStart(2,'0')}:00`,temperatureC:15,apparentTemperatureC:14,relativeHumidityPct:60,precipitationProbabilityPct:0,precipitationMm:0,rainMm:0,showersMm:0,snowfallCm:0,weatherCode:1,cloudCoverPct:0,visibilityM:20000,windSpeedKph:h*2,windDirectionDeg:0,windGustsKph:50,freezingLevelM:3000}))),
    daily:request.requiredDates.map(date=>({date,temperatureMinC:10,temperatureMaxC:20,apparentTemperatureMinC:9,apparentTemperatureMaxC:19,precipitationSumMm:0,precipitationProbabilityMaxPct:0,weatherCode:1,windSpeedMaxKph:46,windGustsMaxKph:50,windDirectionDominantDeg:0,sunrise:`${date}T06:30`,sunset:`${date}T20:30`}))
  }))}
}
const cache=()=>new WeatherCache({getItem:()=>null,setItem(){},removeItem(){}})

for(const travelMode of ['cycling','walking']) test(`${travelMode}: course endpoints, waypoint ETAs, profile and arrival share one terrain-aware interval`,async()=>{
  const {database,bundle}=await setup({travelMode})
  try {
    const next=bounded(bundle), scoped=input(next), curve=computeStageTimingCurve(scoped), full=computeStageTimingCurve(input(next,0,false))
    const points=computeStageWaypoints(scoped), gpxStart=points[0], start=points.find(point=>point.raceBoundary==='start'), finish=points.find(point=>point.raceBoundary==='finish')
    assert.equal(start.trackDistanceKm,6);assert.equal(finish.trackDistanceKm,14)
    assert.equal(gpxStart.trackDistanceKm,0);assert.equal(gpxStart.elapsedMinutes,0);assert.equal(gpxStart.clockTime,'08:00')
    const approachInput={...input(next,0,false),settings:{...scoped.settings,referenceSpeedKph:travelMode==='walking'?scoped.settings.referenceSpeedKph:neutralizedCyclingReferenceSpeed(scoped.settings.referenceSpeedKph)}}
    close(start.elapsedMinutes,computeStageTimingCurve(approachInput).elapsedMinutesAt(6))
    close(finish.elapsedMinutes-start.elapsedMinutes,full.elapsedMinutesAt(14)-full.elapsedMinutesAt(6))
    close(finish.elapsedMinutes-start.elapsedMinutes,8/scoped.settings.referenceSpeedKph*60,.01)
    assert.ok(full.elapsedMinutesAt(6)>0)
    for(const point of points){close(point.elapsedMinutes,curve.elapsedMinutesAt(point.trackDistanceKm));assert.equal(point.clockTime,curve.clockTimeAt(point.trackDistanceKm));assert.equal(point.pauseDurationMinutes,null)}
    assert.notEqual(curve.clockTimeAt(5.999),null);assert.equal(curve.elapsedMinutesAt(14.001),null)
    const eta=computeRideArrivalEta(next,next.days[0])
    assert.equal(eta.label,finish.clockTime);close(eta.minutesFromDayStart,480+finish.elapsedMinutes)
    const detail=buildDayDetail(next,next.days[0].id)
    assert.equal(detail.timingCurve.clockTimeAt(14),finish.clockTime)
    assert.match(detail.statsHtml,/<dt>Distance<\/dt><dd>8,0 km/)
    assert.match(detail.statsHtml,new RegExp(`<dt>Arrivée estimée</dt><dd>${finish.clockTime}`))
    assert.equal(next.stages[0].totalDurationSeconds,bundle.stages[0].totalDurationSeconds)
  }finally{database.close()}
})

test('no-altitude course retains flat-speed timing, and an internal weather point uses its exact course ETA',async()=>{
  const {database,bundle}=await setup({altitude:false})
  try {
    const fixture=createGenericTripBundle(), stage=bundle.stages[0]
    const pass={...fixture.routePoints[2],id:'inside-pass',routeId:stage.sourceRouteId,type:'summit',osmFeatureType:'mountain-pass',name:'Inside',latitude:45.09,longitude:6,elevationM:null,trackDistanceKm:10}
    const climb={...fixture.climbs[0],id:'inside-climb',routeId:stage.sourceRouteId,name:'Inside',startDistanceKm:9,endDistanceKm:10,elevationGainM:0,averageGradientPercent:0,startAltitudeM:null,endAltitudeM:null}
    const enriched={...bundle,routePoints:[...bundle.routePoints,pass],climbs:[...bundle.climbs,climb],stages:bundle.stages.map(s=>s.id===stage.id?{...s,routePointIds:[...s.routePointIds,pass.id],climbIds:[...s.climbIds,climb.id]}:s)}
    const next=bounded(enriched), curve=computeStageTimingCurve(input(next)), definition=buildRideDayWeatherDefinition(next,next.days[0])
    const chainageScale = next.stages[0].distanceKm / buildRaceCourse(next,next.stages[0]).indexed.lengthKm
    close(curve.elapsedMinutesAt(14),(6/15*60+8/18*60)*chainageScale)
    assert.equal(selectStageCourseMetrics(next,next.stages[0]).elevationGainM,null)
    const point=definition.samplePoints.find(point=>point.name==='Inside')
    close(point.eta.totalMinutesFromDeparture,(6/15*60+4/18*60)*chainageScale)
    assert.equal(definition.samplePoints[0].name,next.stages[0].startLocationName)
    for(const point of definition.samplePoints){assert.ok(point.trackDistanceKm===0||point.trackDistanceKm>=6&&point.trackDistanceKm<=14);assert.equal(curve.clockTimeAt(point.trackDistanceKm),computeStageWaypoints(input(next)).find(wp=>wp.id===point.id).clockTime)}
    assert.equal(validateTripBundle(next).ok,true)
  }finally{database.close()}
})

test('after-midnight course forecasts request the ETA dates and completion waits for that actual arrival',async()=>{
  const {database,bundle}=await setup({departureTime:'23:50',altitude:false})
  try {
    const next=bounded(bundle), definition=buildRideDayWeatherDefinition(next,next.days[0]), finish=definition.samplePoints.at(-1)
    assert.equal(finish.eta.dayOffset,1)
    assert.deepEqual(definition.requiredDates,['2027-05-10','2027-05-11'])
    const state=deriveTripTemporalState(next,'2027-05-10T21:55:00Z') // 23:55 Brussels
    assert.equal(state.days[0].completed,false)
    const afterMidnight=deriveTripTemporalState(next,'2027-05-10T22:05:00Z') // May 11, 00:05
    assert.equal(afterMidnight.days[0].completed,false)
    assert.equal(afterMidnight.days[0].current,true)
    assert.equal(afterMidnight.priorityDayId,next.days[0].id)
    assert.equal(deriveTripTemporalState(next,'2027-05-10T22:50:00Z').days[0].completed,true)
    const coordinator=new GenericWeatherCoordinator({provider:{id:'open-meteo',fetchForecast:async request=>forecast(request)},cache:cache(),now:()=>new Date(NOW)})
    try {coordinator.setTripBundle(next,next.days[0].id);await coordinator.waitForIdle();const result=coordinator.getDayWeatherState(next.days[0].id);assert.equal(result.data.waypoints.at(-1).etaLocal.slice(0,10),'2027-05-11')}finally{coordinator.dispose()}
  }finally{database.close()}
})

test('moving a departure reassociates the same cached hourly forecasts; moving bounds requests only new locations',async()=>{
  const {database,bundle}=await setup()
  let calls=[]
  const coordinator=new GenericWeatherCoordinator({provider:{id:'open-meteo',async fetchForecast(request){calls.push(request);return forecast(request)}},cache:cache(),now:()=>new Date(NOW)})
  try {
    const next=bounded(bundle), day=next.days[0]
    coordinator.setTripBundle(next,day.id);await coordinator.waitForIdle()
    const baseline=calls.length, first=coordinator.getDayWeatherState(day.id).data.waypoints[0]
    assert.equal(first.weather.windSpeedKph,16)
    const later={...next,settings:{...next.settings,days:next.settings.days.map(entry=>entry.dayId===day.id?{...entry,departureTime:'10:00'}:entry)}}
    coordinator.setTripBundle(later,day.id);await coordinator.waitForIdle()
    assert.equal(calls.length,baseline)
    assert.equal(coordinator.getDayWeatherState(day.id).data.waypoints[0].weather.windSpeedKph,20)
    coordinator.setTripBundle(bounded(later,7000,13000),day.id);await coordinator.waitForIdle()
    assert.equal(calls.length,baseline+1)
    assert.ok(coordinator.getDayWeatherState(day.id).data.waypoints.some(point=>point.samplePoint.trackDistanceKm===7))
  }finally{coordinator.dispose();database.close()}
})

test('changing bounds clears only the changed course weather in the same persisted update',async()=>{
  const {database,bundle}=await setup()
  try {
    const template=createGenericTripBundle().weather[0]
    const weather=bundle.days.map((day,i)=>({...template,id:`forecast-${i}`,dayId:day.id,forDate:day.date,routePointId:null}))
    const saved={...bundle,weather,stages:bundle.stages.map((stage,i)=>({...stage,weatherRecordIds:[weather[i].id]}))}
    const repository=createTripRepository(database);await repository.saveTripBundle(saved)
    const first=saved.stages[0], fingerprint=buildRaceCourse(saved,first).fingerprint
    const next=await repository.updateTripBundle(saved.metadata.id,latest=>updateRaceCourse(latest,first.id,{routeFingerprint:fingerprint,startOffsetM:6000,finishOffsetM:14000},fingerprint,NOW).bundle)
    assert.deepEqual(next.weather,[weather[1]])
    assert.deepEqual(next.stages[0].weatherRecordIds,[])
    assert.deepEqual(next.stages[1],saved.stages[1])
    assert.deepEqual((await repository.loadTripBundle(saved.metadata.id)).stages,next.stages)
    assert.equal(applyRaceBounds(next,first.id,next.stages[0].raceBounds,fingerprint,NOW),next,'saving identical limits does not invalidate weather again')
  }finally{database.close()}
})

test('a late forecast for previous limits cannot replace the current course association',async()=>{
  const {database,bundle}=await setup()
  const next=bounded(bundle), day=next.days[0], pending=[]
  const coordinator=new GenericWeatherCoordinator({provider:{id:'open-meteo',fetchForecast(request,signal){
    if(request.dayId!==day.id)return Promise.resolve(forecast(request))
    return new Promise(resolve=>pending.push({request,signal,resolve}))
  }},cache:cache(),now:()=>new Date(NOW)})
  try {
    coordinator.setTripBundle(next,day.id)
    await new Promise(setImmediate)
    coordinator.setTripBundle(bounded(next,7000,13000),day.id)
    await new Promise(setImmediate)
    assert.equal(pending.length,2)
    assert.equal(pending[0].signal.aborted,true)
    pending[1].resolve(forecast(pending[1].request))
    await new Promise(setImmediate)
    pending[0].resolve(forecast(pending[0].request))
    await coordinator.waitForIdle()
    const points=coordinator.getDayWeatherState(day.id).data.waypoints
    assert.equal(points[0].samplePoint.trackDistanceKm,0)
    assert.ok(points.some(point=>point.samplePoint.trackDistanceKm===7))
    assert.equal(points.at(-1).samplePoint.trackDistanceKm,13)
    assert.equal(points[0].etaLocal,'2027-05-10T08:00')
  }finally{for(const request of pending)request.resolve(forecast(request.request));coordinator.dispose();database.close()}
})

test('Voyage and a competition without limits retain the complete original timing and weather points',async()=>{
  for(const mode of ['voyage','tour']) {
    const {database,bundle}=await setup({mode})
    try {
      const full=computeStageTimingCurve(input(bundle,0,false)), scoped=computeStageTimingCurve(input(bundle))
      assert.deepEqual(computeStageWaypoints(input(bundle)),computeStageWaypoints(input(bundle,0,false)))
      for(const km of [0,3,10,20])assert.equal(scoped.clockTimeAt(km),full.clockTimeAt(km))
      assert.equal(selectStageCourseMetrics(bundle,bundle.stages[0]),bundle.stages[0])
      const points=buildRideDayWeatherDefinition(bundle,bundle.days[0]).samplePoints
      assert.equal(points[0].trackDistanceKm,0)
      assert.ok(points.at(-1).trackDistanceKm>22)
    }finally{database.close()}
  }
})

test('stale limits suppress timing, weather and operational figures instead of reverting to whole-GPX estimates',async()=>{
  const {database,bundle}=await setup()
  try {
    const next=bounded(bundle), changed={...next,sourceFiles:next.sourceFiles.map(file=>({...file,sha256:'0'.repeat(64)}))}
    assert.equal(computeStageTimingCurve(input(changed)),null)
    assert.deepEqual(computeStageWaypoints(input(changed)),[])
    assert.equal(computeRideArrivalEta(changed,changed.days[0]),null)
    assert.deepEqual(selectStageCourseMetrics(changed,changed.stages[0]),{distanceKm:null,elevationGainM:null,elevationLossM:null})
    assert.equal(summarizeTripBundle(changed).courseLimitsNeedReview,true)
    assert.match(buildTripOverview(changed,NOW).html,/les totaux sont partiels/)
    const definition=buildRideDayWeatherDefinition(changed,changed.days[0])
    assert.deepEqual(definition.locations,[]);assert.match(definition.unavailableReason,/limites/)
    const detail=buildDayDetail(changed,changed.days[0].id)
    assert.equal(detail.statsHtml,'<div data-day-detail-stats hidden></div>')
  }finally{database.close()}
})

test('services on the approach get its slower ETA, while services after the finish have no opening claim',async()=>{
  const {database,bundle}=await setup()
  try {
    const next=bounded(bundle), template=createGenericTripBundle().practicalPlaces[0]
    const places=[{...template,id:'before',trackDistanceKm:2},{...template,id:'within',trackDistanceKm:10},{...template,id:'after',trackDistanceKm:20}]
    const views=buildPracticalPlaceViewModels(places,next.days[0],computeStageTimingCurve(input(next)),'08:00')
    assert.ok(views[0].opening);assert.equal(views[0].passageClockTimeLabel,computeStageTimingCurve(input(next)).clockTimeAt(2))
    assert.equal(views[1].passageClockTimeLabel,computeStageTimingCurve(input(next)).clockTimeAt(10))
    assert.equal(views[2].opening,null);assert.equal(views[2].passageClockTimeLabel,null)
  }finally{database.close()}
})

test('calendar, day cards and overview use course distance while source statistics remain complete',async()=>{
  const {database,bundle}=await setup()
  try {
    const next=bounded(bounded(bundle),6000,14000,1)
    assert.match(renderLeagueCalendar(next),/8,0 km/)
    assert.match(renderTripDetail(next),/8,0 km/)
    assert.equal(summarizeTripBundle(next).totalDistanceKm,16)
    assert.equal(selectStageCourseMetrics(next,next.stages[0]).distanceKm,8)
    assert.ok(bundle.stages[0].distanceKm>22)
    const overview=buildTripOverview(next,NOW)
    assert.match(overview.html,/16,0 km/)
    assert.ok(overview.mapStages.every(stage=>stage.waypoints.length===2&&stage.waypoints.every(wp=>wp.raceBoundary===undefined)&&stage.waypoints.some(wp=>wp.kind==='start'&&wp.trackDistanceKm===0)&&stage.waypoints.some(wp=>wp.kind==='end'&&wp.trackDistanceKm>14)))
  }finally{database.close()}
})

test('extending a Tour course adjusts a conflicting linked departure and invalidates its weather atomically',async()=>{
  const {database,bundle}=await setup({mode:'tour',altitude:false,linked:true})
  try {
    const short=bounded(bundle,1000,2000), secondDay=short.days[1]
    const scheduled={...short,settings:{...short.settings,days:short.settings.days.map(entry=>entry.dayId===secondDay.id?{...entry,departureTime:'08:10'}:entry)}}
    const stage=scheduled.stages[0],fingerprint=stage.raceBounds.routeFingerprint
    const result=updateRaceCourse(scheduled,stage.id,{routeFingerprint:fingerprint,startOffsetM:1000,finishOffsetM:14000},fingerprint,NOW)
    assert.equal(result.adjustments.length,1)
    assert.equal(result.adjustments[0].dayId,secondDay.id)
    assert.equal(result.adjustments[0].to,'09:00')
    assert.equal(result.bundle.days[0].date,result.bundle.days[1].date)
    assert.equal(validateTripBundle(result.bundle).ok,true)
  }finally{database.close()}
})

test('wind averaging and smoothing use only the course length, with GPX coordinates retained for exploration',()=>{
  const geometry=Array.from({length:101},(_,i)=>({latitude:45+i*.001,longitude:6,altitudeM:100}))
  const anchor=(km,speed)=>({samplePoint:{trackDistanceKm:km},state:'available',weather:{windSpeedKph:speed,windDirectionDeg:0,windGustsKph:speed+5}})
  const points=[anchor(0,50),anchor(2,50),anchor(2.1,10),anchor(8,10),anchor(8.1,50),anchor(11.12,50)]
  const model=buildRouteWindModel(geometry,points,{startKm:3,finishKm:7})
  close(model.lengthKm,4);close(model.summary.mean.speedKph,10);close(model.summary.coveredFraction,1)
  assert.ok(buildRouteWindModel(geometry,points).summary.mean.speedKph>10)
  assert.equal(model.at(2.99),null);assert.equal(model.at(7.01),null)
  close(model.at(3,1000).speedKph,10);close(model.at(7,1000).speedKph,10)
})
