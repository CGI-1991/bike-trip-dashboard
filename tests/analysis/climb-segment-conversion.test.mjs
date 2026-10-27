import '../storage/indexeddb/support/setup-fake-indexeddb.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createLinkedTripBundle } from '../trips-manager/support/linked-trip-fixture.mjs'
import { buildRaceCourse, applyRaceBounds } from '../../src/analysis/race-bounds.ts'
import { convertClimbToSegment, revertClimbSegment, convertedClimbId } from '../../src/analysis/climb-segment-conversion.ts'
import { applyRaceSegmentChange } from '../../src/analysis/race-segments.ts'
import { buildDayDetail } from '../../src/ui/trips/day-detail-view.ts'
import { buildGenericRouteMapModel, buildClimbMapLines } from '../../src/ui/route-map-model.ts'
import { withRouteFeatureMarkers } from '../../src/ui/trips/route-feature-markers.ts'
import { pointAtIndexedDistance } from '../../src/route-enrichment/segment-geometry.ts'
import { validateTripBundle, DEFAULT_RACE_SEGMENT_ALERTS } from '../../src/trip-core/index.ts'
import { createTripRepository } from '../../src/storage/indexeddb/trip-repository.ts'
import { openTestDatabase } from '../storage/indexeddb/support/open-test-database.mjs'
import { summarizeTripBundle } from '../../src/trips-manager/trip-summary.ts'

const now='2028-06-01T12:00:00Z'
function fixture(name='Col du test') {
  const base=createLinkedTripBundle({rideCount:1}), bundle={...base,settings:{...base.settings,global:{...base.settings.global,raceMode:true,organizationMode:'tour'}}}
  const stage=bundle.stages[0], course=buildRaceCourse(bundle,stage), length=course.indexed.lengthKm
  const climb={id:'source-climb',routeId:stage.sourceRouteId,name,startDistanceKm:length*.2,endDistanceKm:length*.5,elevationGainM:100,averageGradientPercent:4,
    maxGradientPercent:8,startAltitudeM:100,endAltitudeM:200,confidence:'confirmed',provenance:stage.metricsProvenance}
  bundle.climbs=[climb];bundle.stages=[{...stage,startLocationName:'Genappe',endLocationName:'Namur',climbIds:[climb.id]}]
  return {bundle,stage:bundle.stages[0],climb,course:buildRaceCourse(bundle,bundle.stages[0])}
}

test('conversion keeps the exact detected limits, original climb and route, and double activation is idempotent',()=>{
  const f=fixture(), result=convertClimbToSegment(f.bundle,f.stage.id,f.climb.id,'new',f.course.fingerprint,now)
  assert.equal(validateTripBundle(result).ok,true)
  assert.equal(result.climbs,f.bundle.climbs);assert.equal(result.routes,f.bundle.routes);assert.equal(result.sourceFiles,f.bundle.sourceFiles)
  const segment=result.stages[0].raceSegments[0]
  assert.equal(segment.type,'climb');assert.equal(segment.name,f.climb.name)
  assert.equal(segment.startOffsetM,f.climb.startDistanceKm*1000);assert.equal(segment.endOffsetM,f.climb.endDistanceKm*1000)
  assert.equal(convertedClimbId(segment),f.climb.id)
  assert.equal(convertClimbToSegment(result,f.stage.id,f.climb.id,'another',f.course.fingerprint,now),result)
})

test('reverting deletes only the derived segment and restores the unchanged climb representation',()=>{
  const f=fixture(), converted=convertClimbToSegment(f.bundle,f.stage.id,f.climb.id,'converted',f.course.fingerprint,now)
  const other=applyRaceSegmentChange(converted,f.stage.id,{kind:'add',id:'manual',fields:{type:'sprint',name:'Sprint manuel',startOffsetM:f.course.indexed.lengthKm*600,endOffsetM:f.course.indexed.lengthKm*700,alerts:DEFAULT_RACE_SEGMENT_ALERTS}},f.course.fingerprint,now)
  const restored=revertClimbSegment(other,f.stage.id,'converted',f.course.fingerprint,now)
  assert.deepEqual(restored.stages[0].raceSegments.map(s=>s.id),['manual'])
  assert.equal(restored.climbs,f.bundle.climbs)
  assert.ok(buildDayDetail(restored,f.stage.dayId).waypoints.some(p=>p.climbId===f.climb.id))
  assert.throws(()=>revertClimbSegment(other,f.stage.id,'manual',f.course.fingerprint,now),/conversion/)
  assert.throws(()=>revertClimbSegment({...other,climbs:[]},f.stage.id,'converted',f.course.fingerprint,now),/segment est conservé/)
})

test('stale routes, Voyage and climbs partially outside the course cannot silently create segments',()=>{
  const f=fixture()
  assert.throws(()=>convertClimbToSegment(f.bundle,f.stage.id,f.climb.id,'x','stale',now),/changé/)
  const voyage={...f.bundle,settings:{...f.bundle.settings,global:{...f.bundle.settings.global,raceMode:false,organizationMode:'voyage'}}}
  assert.throws(()=>convertClimbToSegment(voyage,f.stage.id,f.climb.id,'x',f.course.fingerprint,now),/League et Tour/)
  const bounded=applyRaceBounds(f.bundle,f.stage.id,{routeFingerprint:f.course.fingerprint,startOffsetM:0,finishOffsetM:f.climb.endDistanceKm*900},f.course.fingerprint,now)
  assert.throws(()=>convertClimbToSegment(bounded,f.stage.id,f.climb.id,'x',f.course.fingerprint,now),/entièrement/)
})

test('a replaced named summit stays on map/profile, generic summits stay consolidated, and the segment bubble sits at half chainage',()=>{
  for(const name of ['Col du test','Montée 1']){
    const f=fixture(name), converted=convertClimbToSegment(f.bundle,f.stage.id,f.climb.id,'s',f.course.fingerprint,now)
    const detail=buildDayDetail(converted,f.stage.dayId), course=buildRaceCourse(converted,converted.stages[0])
    assert.equal(detail.waypoints.some(p=>p.climbId===f.climb.id),false)
    assert.equal(detail.visualWaypoints.some(p=>p.climbId===f.climb.id),name==='Col du test')
    const middle=(f.climb.startDistanceKm+f.climb.endDistanceKm)/2
    assert.equal(detail.visualWaypoints.find(p=>p.raceSegmentId==='s').trackDistanceKm,middle)
    const model=withRouteFeatureMarkers(buildGenericRouteMapModel(detail.visualWaypoints,[]),detail.visualWaypoints,converted.climbs,course,converted.stages[0].raceSegments)
    const point=pointAtIndexedDistance(course.indexed,middle)
    assert.deepEqual(model.markers.find(m=>m.category==='race-climb').coordinate,[point.latitude,point.longitude])
    assert.equal(buildClimbMapLines(course,converted.stages[0],converted.climbs).length,0)
  }
})

test('GPX cities and endpoints remain distinct from both real course flags',()=>{
  const f=fixture(), bounded=applyRaceBounds(f.bundle,f.stage.id,{routeFingerprint:f.course.fingerprint,startOffsetM:f.course.indexed.lengthKm*100,finishOffsetM:f.course.indexed.lengthKm*800},f.course.fingerprint,now)
  const detail=buildDayDetail(bounded,f.stage.dayId), points=detail.waypoints
  assert.equal(points[0].name,'Genappe');assert.equal(points.at(-1).name,'Namur')
  assert.deepEqual(points.filter(p=>p.raceBoundary).map(p=>p.raceBoundary),['start','finish'])
  assert.ok(points.at(-1).trackDistanceKm>points.find(p=>p.raceBoundary==='finish').trackDistanceKm)
  assert.equal(points.at(-1).clockTime,null,'no invented ETA after the active finish')
  const model=buildGenericRouteMapModel(points,[])
  for(const category of ['start','finish','race-start','race-finish'])assert.equal(model.markers.filter(m=>m.category===category).length,1)
  assert.doesNotMatch(detail.html,/data-next-water/)
})

test('the source relation survives IndexedDB reload and reversal without changing originals',async()=>{
  const db=await openTestDatabase()
  try{
    const f=fixture(), repository=createTripRepository(db)
    const converted=convertClimbToSegment(f.bundle,f.stage.id,f.climb.id,'s',f.course.fingerprint,now)
    await repository.saveTripBundle(converted)
    const loaded=await repository.loadTripBundle(f.bundle.metadata.id)
    assert.equal(convertedClimbId(loaded.stages[0].raceSegments[0]),f.climb.id)
    const restored=revertClimbSegment(loaded,f.stage.id,'s',f.course.fingerprint,now)
    assert.deepEqual(restored.climbs,f.bundle.climbs);assert.deepEqual(restored.routes,f.bundle.routes)
  }finally{db.close()}
})

test('the activities summary distinguishes all three modes, including a legacy Tour',()=>{
  const {bundle}=fixture()
  for(const organizationMode of ['voyage','tour','league']){
    const value={...bundle,settings:{...bundle.settings,global:{...bundle.settings.global,organizationMode,raceMode:organizationMode!=='voyage'}}}
    assert.equal(summarizeTripBundle(value).organizationMode,organizationMode)
  }
  const {organizationMode:_,...legacy}=bundle.settings.global
  assert.equal(summarizeTripBundle({...bundle,settings:{...bundle.settings,global:legacy}}).organizationMode,'tour')
})
