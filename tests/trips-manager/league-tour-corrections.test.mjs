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
import { applyRaceSegmentChange } from '../../src/analysis/race-segments.ts'
import { consolidateRaceWaypoints, segmentMatchesClimb } from '../../src/analysis/race-segment-waypoints.ts'
import { computeStageWaypoints } from '../../src/analysis/waypoint-timeline.ts'
import { DEFAULT_RACE_SEGMENT_ALERTS, selectOrganizationCapabilities, validateTripBundle } from '../../src/trip-core/index.ts'
import { REFERENCE_SPEED_MODES, REFERENCE_SPEED_PRESETS, resolveReferenceSpeedMode } from '../../src/trip-core/model/reference-speed.ts'
import { buildDayDetail } from '../../src/ui/trips/day-detail-view.ts'
import { buildTripOverview } from '../../src/ui/trips/trip-overview-view.ts'
import { renderTripDetail } from '../../src/ui/trips/trip-detail-view.ts'
import { buildGenericAppHeader } from '../../src/ui/trips/app-header.ts'
import { buildGenericRouteMapModel } from '../../src/ui/route-map-model.ts'
import { applyTripPreferences, tripPreferencesUpdateIsNoop, updateTripPreferences } from '../../src/trips-manager/trip-preferences.ts'
import { createTripRepository } from '../../src/storage/indexeddb/trip-repository.ts'
import { summarizeTripBundle } from '../../src/trips-manager/trip-summary.ts'
const NOW='2027-05-09T06:00:00.000Z'
async function setup(mode='league') {
  const database=await openImportTestDatabase()
  const file=toGpxImportFile(buildGpxXml({tracks:[{name:'Course',segments:[Array.from({length:201},(_,i)=>({lat:45+i*.001,lon:6,ele:200+i*3}))]}]}),'course.gpx')
  const result=await importGpxTrip({database,files:[file],options:{tripId:'corrections',slug:'corrections',name:'Corrections',organizationMode:mode,startDate:'2027-05-10',timezone:'Europe/Brussels',importedAt:NOW,engineVersion:'test'},dayStructure:[{kind:'ride',eventDate:'2027-05-10',departureTime:'08:00'}],idFactory:createIdFactory('correction'),now:fixedNow()})
  assert.equal(result.ok,true,result.error?.message)
  return {database,bundle:result.bundle}
}
function bounded(bundle,start=1000,finish=20000) {
  const course=buildRaceCourse(bundle,bundle.stages[0])
  return applyRaceBounds(bundle,bundle.stages[0].id,{routeFingerprint:course.fingerprint,startOffsetM:start,finishOffsetM:finish},course.fingerprint,NOW)
}
function add(bundle,id='manual',start=2400,end=5700) {
  return applyRaceSegmentChange(bundle,bundle.stages[0].id,{kind:'add',id,fields:{type:'climb',name:'GRIMPEUR 2',startOffsetM:start,endOffsetM:end,alerts:DEFAULT_RACE_SEGMENT_ALERTS}},buildRaceCourse(bundle,bundle.stages[0]).fingerprint,NOW)
}

test('League has a calendar tab, no overview calendar or global wind, with relative wind on each course, and no course statistics without explicit valid bounds',async()=>{
  const {database,bundle}=await setup()
  try {
    const detail=buildDayDetail(bundle,bundle.days[0].id),overview=buildTripOverview(bundle,NOW).html
    assert.equal(detail.statsHtml,'<div data-day-detail-stats hidden></div>')
    assert.deepEqual(selectStageCourseMetrics(bundle,bundle.stages[0]),{distanceKm:null,elevationGainM:null,elevationLossM:null})
    assert.doesNotMatch(overview,/data-league-calendar|data-trip-wind-summary|Distance totale|D\+ total/)
    assert.doesNotMatch(renderTripDetail(bundle,NOW),/data-trip-wind-summary|trip-day-card__metrics/)
    assert.match(renderTripDetail(bundle,NOW),/data-league-calendar/)
    assert.equal(buildGenericAppHeader(bundle,{view:'overview'}).tripTabLabel,'Calendrier')
    assert.equal(selectOrganizationCapabilities(bundle).relativeWind,true)
    assert.equal(summarizeTripBundle(bundle).courseStatsUnavailable,true)
    // A missing/obsolete finish must never cause a fallback to the GPX end.
    const fingerprint=buildRaceCourse(bundle,bundle.stages[0]).fingerprint
    for (const bounds of [{routeFingerprint:fingerprint,startOffsetM:1000},{routeFingerprint:'old',startOffsetM:1000,finishOffsetM:20000}]) {
      const stale={...bundle,stages:bundle.stages.map(stage=>({...stage,raceBounds:bounds}))}
      assert.equal(selectStageCourseMetrics(stale,stale.stages[0]).distanceKm,null)
      assert.doesNotMatch(buildDayDetail(stale,stale.days[0].id).statsHtml,/<dl/)
    }
    const next=bounded(bundle)
    const stats=buildDayDetail(next,next.days[0].id).statsHtml
    assert.match(stats,/<dt>Distance<\/dt><dd>19,0 km/)
    assert.equal((buildDayDetail(next,next.days[0].id).html.match(/day-detail__stats-card/g)||[]).length,1)
    assert.equal(summarizeTripBundle(next).courseStatsUnavailable,undefined)
    const cleared=applyRaceBounds(next,next.stages[0].id,null,fingerprint,NOW)
    assert.doesNotMatch(buildDayDetail(cleared,cleared.days[0].id).statsHtml,/<dl/)
  }finally {database.close()}
})

test('Tour and classic Voyage retain their relative wind and full source statistics; navigation differs centrally',async()=>{
  for (const mode of ['voyage','tour']) {
    const {database,bundle}=await setup(mode)
    try {
      assert.equal(selectOrganizationCapabilities(bundle).relativeWind,true)
      assert.equal(selectOrganizationCapabilities(bundle).tripTabLabel,mode==='tour'?'Étapes':'Voyage')
      assert.doesNotMatch(buildTripOverview(bundle,NOW).html,/data-trip-wind-summary/)
      assert.equal(selectStageCourseMetrics(bundle,bundle.stages[0]),bundle.stages[0])
      assert.match(buildDayDetail(bundle,bundle.days[0].id).statsHtml,/<dt>Distance/)
    }finally {database.close()}
  }
})

test('clear overlap replaces just the corresponding automatic climb in a single ordered timeline, keeping endpoints and manual ownership',async()=>{
  const {database,bundle}=await setup()
  try {
    const original=bundle.climbs[0]
    assert.ok(original)
    const climbs=[{...original,id:'matched',startDistanceKm:2.3,endDistanceKm:5.8,name:'Montée couverte'},{...original,id:'uncovered',startDistanceKm:8,endDistanceKm:10,name:'Montée gardée'}]
    const prepared={...bundle,climbs,stages:bundle.stages.map(stage=>({...stage,climbIds:climbs.map(climb=>climb.id)}))}
    const next=add(bounded(prepared)),stage=next.stages[0],course=buildRaceCourse(next,stage)
    const points=computeStageWaypoints({stage,route:next.routes[0],climbs:next.climbs,routePoints:next.routePoints,raceCourse:course,settings:{referenceSpeedKph:18,departureTime:'08:00'}})
    assert.equal(points.filter(point=>point.raceSegmentId==='manual').length,1)
    assert.equal(points.some(point=>point.climbId==='matched'),false)
    assert.equal(points.some(point=>point.climbId==='uncovered'),true)
    assert.equal(points[0].kind,'start');assert.equal(points.at(-1).kind,'end')
    assert.ok(points.every((point,i)=>i===0||point.trackDistanceKm>=points[i-1].trackDistanceKm))
    const detail=buildDayDetail(next,next.days[0].id)
    assert.equal((detail.timelineHtml.match(/data-segment-view=/g)||[]).length,1)
    assert.match(detail.timelineHtml,/GRIMPEUR 2/);assert.match(detail.timelineHtml,/Montée gardée/)
    assert.doesNotMatch(detail.timelineHtml,/Montée couverte|race-segments__list/)
    assert.equal(buildGenericRouteMapModel(points,[]).markers.some(marker=>marker.name==='GRIMPEUR 2'),false)
    const recalc=applyTripPreferences(next,{climbDetectionSensitivity:'flat'},NOW,createIdFactory('recalc'))
    assert.deepEqual(recalc.stages[0].raceSegments,next.stages[0].raceSegments)
    assert.deepEqual(recalc.routes,next.routes)
    // Pure consolidation never changes the stored detector results.
    assert.equal(next.climbs,prepared.climbs)
  }finally {database.close()}
})

test('overlap matching tolerates nearby endpoints but rejects a short nested sprint, distant passes, contact and ambiguous partial overlap',()=>{
  const segment={startOffsetM:42400,endOffsetM:45700}
  assert.equal(segmentMatchesClimb(segment,{startDistanceKm:42.3,endDistanceKm:45.8}),true)
  assert.equal(segmentMatchesClimb({startOffsetM:44000,endOffsetM:44100},{startDistanceKm:42.3,endDistanceKm:45.8}),false)
  assert.equal(segmentMatchesClimb(segment,{startDistanceKm:2.3,endDistanceKm:5.8}),false)
  assert.equal(segmentMatchesClimb(segment,{startDistanceKm:45.7,endDistanceKm:47}),false)
  assert.equal(segmentMatchesClimb(segment,{startDistanceKm:44,endDistanceKm:48}),false)
})

test('overlapping explicit segments all remain visible; stale/out-of-course segments cannot mask an automatic climb',async()=>{
  const {database,bundle}=await setup('tour')
  try {
    const next=add(add(bundle,'one'),'two',2500,5600),stage=next.stages[0],course=buildRaceCourse(next,stage)
    const base=[{id:'climb',climbId:bundle.climbs[0].id,kind:'climb',trackDistanceKm:5.8}]
    const climb={...bundle.climbs[0],startDistanceKm:2.3,endDistanceKm:5.8}
    assert.equal(consolidateRaceWaypoints(base,stage,[climb],course).filter(point=>point.raceSegmentId).length,2)
    const staleStage={...stage,raceSegments:stage.raceSegments.map(segment=>({...segment,routeFingerprint:'old'}))}
    assert.equal(consolidateRaceWaypoints(base,staleStage,[climb],course),base)
    const restricted=bounded(next,6000,20000)
    assert.equal(consolidateRaceWaypoints(base,restricted.stages[0],[climb],buildRaceCourse(restricted,restricted.stages[0])),base)
    assert.match(buildDayDetail(restricted,restricted.days[0].id).timelineHtml,/Hors course/)
  }finally {database.close()}
})

test('five speed presets are strictly increasing for both sports; manual km/h and manual selection at a preset value survive IndexedDB reload',async()=>{
  assert.deepEqual(REFERENCE_SPEED_MODES,['chill','tempo','normal','sustained','sporty','manual'])
  for (const mode of ['cycling','walking']) {
    const {database,bundle}=await setup('tour')
    try {
      const values=Object.values(REFERENCE_SPEED_PRESETS[mode])
      assert.ok(values.every((value,i)=>i===0||value>values[i-1]))
      assert.equal(REFERENCE_SPEED_PRESETS[mode].normal,mode==='cycling'?18:4.5)
      for (const preset of REFERENCE_SPEED_MODES.filter(value=>value!=='manual')) {
        const next=applyTripPreferences(bundle,{travelMode:mode,referenceSpeedMode:preset},NOW)
        assert.equal(next.settings.global.referenceSpeedKph,REFERENCE_SPEED_PRESETS[mode][preset])
        assert.equal(validateTripBundle(next).ok,true)
      }
      const speed=mode==='cycling'?21.3:4.7
      const result=await updateTripPreferences({database,tripId:bundle.metadata.id,update:{travelMode:mode,referenceSpeedMode:'manual',referenceSpeedKph:speed},now:()=>NOW})
      assert.equal(result.ok,true)
      const stored=await createTripRepository(database).loadTripBundle(bundle.metadata.id)
      assert.equal(stored.settings.global.referenceSpeedKph,speed)
      assert.equal(stored.settings.global.referenceSpeedMode,'manual')
      assert.equal(resolveReferenceSpeedMode(REFERENCE_SPEED_PRESETS[mode].normal,mode,'manual'),'manual')
      assert.equal(tripPreferencesUpdateIsNoop(stored,{referenceSpeedMode:'manual',referenceSpeedKph:speed}),true)
      const invalid={...stored,settings:{...stored.settings,global:{...stored.settings.global,referenceSpeedMode:'fake'}}}
      assert.equal(validateTripBundle(invalid).ok,false)
    }finally {database.close()}
  }
})

test('competition controls live in Course next to Météo, while segment cards expand a read-only mini-profile',async()=>{
  const {database,bundle}=await setup('tour')
  try {
    const next=add(bounded(bundle)),detail=buildDayDetail(next,next.days[0].id)
    assert.match(detail.html,/aria-controls="day-bottom-panel-course">Course/)
    assert.match(detail.html,/aria-controls="day-bottom-panel-weather">Météo/)
    assert.doesNotMatch(detail.html,/aria-controls="day-bottom-panel-pauses"/)
    assert.match(detail.html,/data-day-profile-home/);assert.match(detail.html,/data-course-profile-target/)
    assert.match(detail.timelineHtml,/data-segment-view="manual"/)
    assert.match(detail.timelineHtml,/id="segment-profile-manual" data-climb-profile hidden/)
    assert.match(detail.timelineHtml,/data-climb-profile-interactive/)
    assert.match(detail.timelineHtml,/aria-label="Profil interactif du segment"/)
    assert.match(detail.timelineHtml,/data-wind-start-km="2.4" data-wind-end-km="5.7"/)
    assert.doesNotMatch(detail.timelineHtml,/data-segment-edit|data-segment-field/)
    const noAltitude={...next,routes:next.routes.map(route=>({...route,geometry:{...route.geometry,full:route.geometry.full.map(point=>({...point,altitudeM:null}))}}))}
    assert.match(buildDayDetail(noAltitude,noAltitude.days[0].id).timelineHtml,/Profil altimétrique indisponible pour ce segment/)
  }finally{database.close()}
})
