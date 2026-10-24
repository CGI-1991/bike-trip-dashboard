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
import { consolidateRaceWaypoints, raceCourseClimbCount, segmentMatchesClimb } from '../../src/analysis/race-segment-waypoints.ts'
import { renderRaceSegmentTimelineRow } from '../../src/ui/trips/race-segment-timeline.ts'
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

test('League uses GPX endpoints by default, while obsolete explicit bounds still block course statistics',async()=>{
  const {database,bundle}=await setup()
  try {
    const detail=buildDayDetail(bundle,bundle.days[0].id),overview=buildTripOverview(bundle,NOW).html
    assert.match(detail.statsHtml,/<dt>Distance/)
    assert.equal(selectStageCourseMetrics(bundle,bundle.stages[0]),bundle.stages[0])
    assert.doesNotMatch(overview,/data-league-calendar|data-trip-wind-summary/)
    assert.match(renderTripDetail(bundle,NOW),/data-league-calendar/)
    assert.doesNotMatch(renderTripDetail(bundle,NOW),/data-trip-wind-summary/)
    assert.equal(buildGenericAppHeader(bundle,{view:'overview'}).tripTabLabel,'Calendrier')
    assert.equal(selectOrganizationCapabilities(bundle).relativeWind,true)
    assert.equal(summarizeTripBundle(bundle).courseStatsUnavailable,undefined)
    const fingerprint=buildRaceCourse(bundle,bundle.stages[0]).fingerprint
    // Absent bounds mean defaults; a malformed/obsolete saved reference is
    // still invalid and must never silently become a new set of bounds.
    for (const bounds of [{routeFingerprint:fingerprint,startOffsetM:1000},{routeFingerprint:'old',startOffsetM:1000,finishOffsetM:20000}]) {
      const stale={...bundle,stages:bundle.stages.map(stage=>({...stage,raceBounds:bounds}))}
      assert.equal(selectStageCourseMetrics(stale,stale.stages[0]).distanceKm,null)
      assert.doesNotMatch(buildDayDetail(stale,stale.days[0].id).statsHtml,/<dl/)
    }
    const next=bounded(bundle)
    assert.match(buildDayDetail(next,next.days[0].id).statsHtml,/<dt>Distance<\/dt><dd>19,0 km/)
    assert.equal((buildDayDetail(next,next.days[0].id).html.match(/day-detail__stats-card/g)||[]).length,1)
    const cleared=applyRaceBounds(next,next.stages[0].id,null,fingerprint,NOW)
    assert.match(buildDayDetail(cleared,cleared.days[0].id).statsHtml,/<dt>Distance/)
    assert.equal(selectStageCourseMetrics(cleared,cleared.stages[0]),cleared.stages[0])
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

test('manual priority includes contained climbs, nested sprints and partial conflicts, using chainage and excluding endpoint contact',()=>{
  const segment={startOffsetM:42400,endOffsetM:45700}
  assert.equal(segmentMatchesClimb(segment,{startDistanceKm:42.3,endDistanceKm:45.8}),true)
  assert.equal(segmentMatchesClimb({startOffsetM:44000,endOffsetM:44100},{startDistanceKm:42.3,endDistanceKm:45.8}),true)
  assert.equal(segmentMatchesClimb(segment,{startDistanceKm:2.3,endDistanceKm:5.8}),false)
  assert.equal(segmentMatchesClimb(segment,{startDistanceKm:45.7,endDistanceKm:47}),false)
  assert.equal(segmentMatchesClimb(segment,{startDistanceKm:45.6,endDistanceKm:47}),true)
  assert.equal(segmentMatchesClimb(segment,{startDistanceKm:44,endDistanceKm:48}),true)
  assert.equal(segmentMatchesClimb({startOffsetM:0,endOffsetM:18400},{startDistanceKm:0,endDistanceKm:7.4}),true)
  assert.equal(segmentMatchesClimb({startOffsetM:0,endOffsetM:18400},{startDistanceKm:7.8,endDistanceKm:15.6}),true)
  assert.equal(segmentMatchesClimb(segment,{startDistanceKm:44,endDistanceKm:44}),false)
})

test('a long Grimpeur replaces contained climbs and their named passes consistently, without deleting stored climbs',async()=>{
  const {database,bundle}=await setup()
  try {
    const original=bundle.climbs[0]
    const climbs=[{...original,id:'first',startDistanceKm:0,endDistanceKm:7.4,name:'Montée 1'},
      {...original,id:'col',startDistanceKm:7.8,endDistanceKm:15.6,name:'Col du Feu'},
      {...original,id:'later',startDistanceKm:19,endDistanceKm:21,name:'Montée suivante'}]
    const prepared={...bundle,climbs,stages:bundle.stages.map(stage=>({...stage,climbIds:climbs.map(c=>c.id)}))}
    const next=add(prepared,'long',0,18400),stage=next.stages[0],course=buildRaceCourse(next,stage)
    const base=[{id:'start',kind:'start',climbId:'first',trackDistanceKm:0},
      {id:'first',kind:'climb',climbId:'first',trackDistanceKm:7.4},
      {id:'pass',kind:'mountain-pass',climbId:'col',trackDistanceKm:15.6},
      {id:'independent',kind:'saddle',climbId:null,trackDistanceKm:17},
      {id:'later',kind:'climb',climbId:'later',trackDistanceKm:21},
      {id:'end',kind:'end',climbId:null,trackDistanceKm:22}]
    const snapshot=JSON.stringify({base,next})
    const points=consolidateRaceWaypoints(base,stage,climbs,course)
    assert.deepEqual(points.map(p=>p.id),['start',`${stage.id}:segment:long`,'independent','later','end'])
    assert.equal(raceCourseClimbCount(stage,climbs,course),2,'one manual Grimpeur plus the remaining automatic climb')
    const detail=buildDayDetail(next,next.days[0].id)
    assert.doesNotMatch(detail.timelineHtml,/Montée 1|Col du Feu/)
    assert.match(detail.timelineHtml,/Montée suivante/)
    assert.match(detail.statsHtml,/<dt>Montées .*?<\/dt><dd>2<\/dd>/s)
    assert.equal(JSON.stringify({base,next}),snapshot)
    const removed={...stage,raceSegments:[]}
    assert.equal(consolidateRaceWaypoints(base,removed,climbs,course),base)
    assert.equal(raceCourseClimbCount(removed,climbs,course),3)
    for(const type of ['sprint','flandrien']) assert.equal(raceCourseClimbCount({...stage,raceSegments:stage.raceSegments.map(s=>({...s,type}))},climbs,course),1)
  }finally{database.close()}
})

test('all segment types share compact climb metadata while retaining weather, wind and read-only profiles',async()=>{
  const {database,bundle}=await setup()
  try {
    const next=add(bundle),stage=next.stages[0],course=buildRaceCourse(next,stage)
    for(const type of ['climb','sprint','flandrien']) {
      const html=renderRaceSegmentTimelineRow(course,{...stage.raceSegments[0],type})
      assert.match(html,/timeline-meta">3,3 km · \+\d+ m · \d+,\d %<\/span>/)
      assert.doesNotMatch(html,/km 2,4 → 5,7|% net|D\+ \d+/)
      assert.match(html,/day-detail__timeline-time-col/)
      assert.match(html,/data-waypoint-weather/)
      assert.match(html,/data-wind-start-km="2.4" data-wind-end-km="5.7"/)
      assert.match(html,/data-action="toggle-climb-profile"/)
    }
    const stale=renderRaceSegmentTimelineRow(course,{...stage.raceSegments[0],routeFingerprint:'old'})
    assert.match(stale,/— km · D\+ — · — %/)
    assert.match(stale,/Trace modifiée · à replacer/)
  }finally{database.close()}
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
