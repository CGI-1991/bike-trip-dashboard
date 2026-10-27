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
import { computeStageTimingCurve, computeStageWaypoints } from '../../src/analysis/waypoint-timeline.ts'
import { selectOrganizationCapabilities } from '../../src/trip-core/index.ts'
import { buildDayDetail } from '../../src/ui/trips/day-detail-view.ts'
import { renderGenericElevationProfile } from '../../src/ui/elevation-profile.ts'
import { buildRideDayWeatherDefinition } from '../../src/weather/generic/sample-points.ts'
import { deriveTripTemporalState } from '../../src/trips-manager/trip-day-temporal-state.ts'

const NOW='2027-05-09T06:00:00.000Z'
const close=(actual,expected,tolerance=.001)=>assert.ok(Math.abs(actual-expected)<tolerance,`${actual} != ${expected}`)
async function fixture({mode='league',travelMode='cycling',referenceSpeedKph=18,departureTime='08:00',steep=false}={}){
  const database=await openImportTestDatabase()
  const xml=buildGpxXml({tracks:[{segments:[Array.from({length:201},(_,i)=>({lat:45+i*.001,lon:6,...(steep?{ele:200+i*30}:{})}))]}]})
  const result=await importGpxTrip({database,files:[toGpxImportFile(xml,'old-recording.gpx')],options:{tripId:'departure',slug:'departure',name:'Departure',organizationMode:mode,travelMode,referenceSpeedKph,startDate:'2027-05-10',timezone:'Europe/Brussels',importedAt:NOW,engineVersion:'test'},dayStructure:[{kind:'ride',eventDate:'2027-05-10',departureTime}],idFactory:createIdFactory('departure'),now:fixedNow()})
  assert.equal(result.ok,true,result.error?.message)
  return {database,bundle:result.bundle}
}
function input(bundle,settings={}){
  const stage=bundle.stages[0]
  return {stage,route:bundle.routes[0],routePoints:bundle.routePoints,climbs:bundle.climbs,raceCourse:buildRaceCourse(bundle,stage),
    settings:{referenceSpeedKph:bundle.settings.global.referenceSpeedKph,travelMode:bundle.settings.global.travelMode,departureTime:bundle.settings.days[0].departureTime,...settings},manualPauses:[],automaticPausesAllowed:false}
}
function bound(bundle){const stage=bundle.stages[0],fingerprint=buildRaceCourse(bundle,stage).fingerprint;return applyRaceBounds(bundle,stage.id,{routeFingerprint:fingerprint,startOffsetM:1000,finishOffsetM:4000},fingerprint,NOW)}

test('a flat approach at 15 km/h precedes a 3 km race at 18 km/h; GPX hour, real start, course duration and ETA stay distinct',async()=>{
  const {database,bundle}=await fixture()
  try{
    const next=bound(bundle),curve=computeStageTimingCurve(input(next)),waypoints=computeStageWaypoints(input(next)),detail=buildDayDetail(next,next.days[0].id)
    close(curve.elapsedMinutesAt(0),0);close(curve.elapsedMinutesAt(.5),2);close(curve.elapsedMinutesAt(1),4);close(curve.elapsedMinutesAt(4),14)
    assert.equal(curve.clockTimeAt(0),'08:00');assert.equal(curve.clockTimeAt(1),'08:04');assert.equal(curve.clockTimeAt(4),'08:14')
    assert.deepEqual(waypoints.filter(point=>point.kind==='start').map(point=>[point.name,point.clockTime]),[[next.stages[0].startLocationName,'08:00'],['Départ réel','08:04']])
    assert.match(detail.statsHtml,/<dt>Départ GPX/);assert.match(detail.statsHtml,/<dt>Départ réel estimé<\/dt><dd>08:04/)
    assert.match(detail.statsHtml,/<dt>Durée de course<\/dt><dd>0 h 10/)
    assert.equal(selectStageCourseMetrics(next,next.stages[0]).distanceKm,3)
    assert.equal(next.routes,bundle.routes);assert.equal(next.sourceFiles,bundle.sourceFiles)
  }finally{database.close()}
})

test('the neutralized approach uses the terrain engine and its speed caps, not a scalar ratio of race timing',async()=>{
  const {database,bundle}=await fixture({referenceSpeedKph:8,steep:true})
  try{
    const next=bound(bundle),scoped=input(next),curve=computeStageTimingCurve(scoped)
    const slow=computeStageTimingCurve({...scoped,raceCourse:undefined,settings:{...scoped.settings,referenceSpeedKph:5}})
    const normal=computeStageTimingCurve({...scoped,raceCourse:undefined})
    close(curve.elapsedMinutesAt(1),slow.elapsedMinutesAt(1))
    close(curve.elapsedMinutesAt(4)-curve.elapsedMinutesAt(1),normal.elapsedMinutesAt(4)-normal.elapsedMinutesAt(1))
    assert.ok(Math.abs(curve.elapsedMinutesAt(1)-normal.elapsedMinutesAt(1)*8/5)>1)
  }finally{database.close()}
})

test('GPX departure near midnight propagates the approach into forecast dates and completion',async()=>{
  const {database,bundle}=await fixture({departureTime:'23:55'})
  try{
    const next=bound(bundle),definition=buildRideDayWeatherDefinition(next,next.days[0])
    assert.deepEqual(definition.requiredDates,['2027-05-10','2027-05-11'])
    close(definition.samplePoints[0].eta.totalMinutesFromDeparture,0)
    close(definition.samplePoints.at(-1).eta.totalMinutesFromDeparture,14)
    assert.equal(definition.samplePoints.at(-1).eta.dayOffset,1)
    assert.equal(deriveTripTemporalState(next,'2027-05-10T22:05:00Z').days[0].completed,false)
    assert.equal(deriveTripTemporalState(next,'2027-05-10T22:10:00Z').days[0].completed,true)
  }finally{database.close()}
})

test('all walking organizations omit wind stats and wind profile controls without changing cycling preferences',async()=>{
  for(const mode of ['voyage','league','tour']){
    const {database,bundle}=await fixture({mode,travelMode:'walking',referenceSpeedKph:4.5,steep:true})
    try{
      const capabilities=selectOrganizationCapabilities(bundle),detail=buildDayDetail(bundle,bundle.days[0].id)
      assert.equal(capabilities.relativeWind,false)
      assert.doesNotMatch(detail.statsHtml,/data-stage-wind-stat/)
      const profile={innerHTML:''}
      renderGenericElevationProfile(profile,detail.geometry,detail.waypoints,'Randonnée',detail.timingCurve,{relativeWind:capabilities.relativeWind})
      assert.match(profile.innerHTML,/data-profile-mode="grade"/)
      assert.doesNotMatch(profile.innerHTML,/data-profile-mode="wind"|data-profile-wind|Détails du vent/)
      const cycling={...bundle,settings:{...bundle.settings,global:{...bundle.settings.global,travelMode:'cycling'}}}
      assert.equal(selectOrganizationCapabilities(cycling).relativeWind,true)
    }finally{database.close()}
  }
})

test('walking keeps its reference pace on the approach and clearing bounds restores full GPX timing',async()=>{
  const {database,bundle}=await fixture({travelMode:'walking',referenceSpeedKph:4.5})
  try{
    const next=bound(bundle),curve=computeStageTimingCurve(input(next)),full=computeStageTimingCurve({...input(next),raceCourse:undefined})
    for(const km of [0,.5,1,3,4])close(curve.elapsedMinutesAt(km),full.elapsedMinutesAt(km))
    const fingerprint=buildRaceCourse(next,next.stages[0]).fingerprint
    const reset=applyRaceBounds(next,next.stages[0].id,null,fingerprint,NOW)
    assert.equal(selectStageCourseMetrics(reset,reset.stages[0]),reset.stages[0])
    assert.equal(computeStageTimingCurve(input(reset)).clockTimeAt(10),full.clockTimeAt(10))
  }finally{database.close()}
})
