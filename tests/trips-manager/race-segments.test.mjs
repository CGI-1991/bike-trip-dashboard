import '../storage/indexeddb/support/setup-fake-indexeddb.mjs'
import '../ui/support/dom-shim.mjs'
import { installMinimalDOMParser } from '../support/minimal-dom-parser.mjs'
installMinimalDOMParser()
import test from 'node:test'
import assert from 'node:assert/strict'
import { importGpxTrip } from '../../src/import/gpx/import-gpx-trip.ts'
import { buildGpxXml, toGpxImportFile } from '../import/gpx/support/fixtures.mjs'
import { createIdFactory, fixedNow, openImportTestDatabase } from '../import/gpx/support/run-import.mjs'
import { applyRaceBounds, buildRaceCourse } from '../../src/analysis/race-bounds.ts'
import { analyzeRaceSegment, applyRaceSegmentChange, projectRacePosition, raceSegmentLanes } from '../../src/analysis/race-segments.ts'
import { DEFAULT_RACE_SEGMENT_ALERTS, validateTripBundle } from '../../src/trip-core/index.ts'
import { createTripRepository } from '../../src/storage/indexeddb/trip-repository.ts'
import { loadTripEditDraft, editGpxTrip } from '../../src/trips-manager/trip-editor.ts'
import { applyClimbDetectionSensitivity } from '../../src/trips-manager/climb-sensitivity.ts'
import { applyRaceMode } from '../../src/trips-manager/race-mode.ts'
import { createTripBackup, prepareTripBackupRestore, restorePreparedTripBackup } from '../../src/backup/trip-backup.ts'
import { createSourceFileRepository } from '../../src/storage/indexeddb/source-file-repository.ts'
import { renderRaceSegmentProfile, renderRaceSegmentsPanel } from '../../src/ui/trips/race-segments-view.ts'
import { buildGenericRouteMapModel } from '../../src/ui/route-map-model.ts'

const NOW='2027-05-09T06:00:00.000Z'
const close=(a,b,tolerance=.001)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`)
const file=(name='course',lat=45,altitude=true)=>toGpxImportFile(buildGpxXml({tracks:[{name,segments:[Array.from({length:201},(_,i)=>({lat:lat+i*.001,lon:6,...(altitude?{ele:200+i*3}:{})}))]}]}),`${name}.gpx`)
async function setup(mode='league',altitude=true,firstFile){
  const database=await openImportTestDatabase(),files=[firstFile??file('first',45,altitude),file('second',46,altitude)]
  const result=await importGpxTrip({database,files,options:{tripId:'segments',slug:'segments',name:'Segments',organizationMode:mode,startDate:'2027-05-10',timezone:'Europe/Brussels',importedAt:NOW,engineVersion:'test'},dayStructure:files.map((_,i)=>({kind:'ride',eventDate:i===0?'2027-05-10':'2027-05-15',departureTime:'08:00'})),idFactory:createIdFactory('segment'),now:fixedNow()})
  assert.equal(result.ok,true,result.error?.message)
  return {database,bundle:result.bundle,files}
}
const fields=(type='sprint',start=1000,end=2000)=>({type,name:`${type} test`,startOffsetM:start,endOffsetM:end,alerts:{...DEFAULT_RACE_SEGMENT_ALERTS}})
function change(bundle,operation,index=0){const stage=bundle.stages[index];return applyRaceSegmentChange(bundle,stage.id,operation,buildRaceCourse(bundle,stage).fingerprint,NOW)}
const add=(bundle,id='s1',values=fields(),index=0)=>change(bundle,{kind:'add',id,fields:values},index)
const analyze=(bundle,index=0,segmentIndex=0)=>analyzeRaceSegment(buildRaceCourse(bundle,bundle.stages[index]),bundle.stages[index].raceSegments[segmentIndex])

for(const mode of ['league','tour'])test(`${mode}: create all manual types without changing climbs, timing, weather, POI or GPX`,async()=>{
  const {database,bundle}=await setup(mode)
  try{
    let next=bundle
    for(const [i,type] of ['sprint','climb','flandrien'].entries())next=add(next,`s${i}`,fields(type,1000+i*500,2500+i*500))
    assert.deepEqual(next.stages[0].raceSegments.map(segment=>segment.type),['sprint','climb','flandrien'])
    for(const key of ['routes','sourceFiles','climbs','weather','practicalPlaces','days','settings','enrichmentMetadata'])assert.equal(next[key],bundle[key])
    assert.equal(next.stages[0].totalDurationSeconds,bundle.stages[0].totalDurationSeconds)
    assert.equal(next.stages[1],bundle.stages[1])
    assert.ok(next.stages[0].raceSegments.every(segment=>segment.provenance.sourceType==='user'&&segment.provenance.manuallyOverridden))
    assert.equal(validateTripBundle(next).ok,true)
  }finally{database.close()}
})

test('editing changes type, name, bounds and alerts with a stable id; overlapping segments have separate lanes',async()=>{
  const {database,bundle}=await setup()
  try{
    const next=add(add(bundle,'s1',fields('sprint',1000,3000)),'s2',fields('flandrien',2000,4000))
    const edited=change(next,{kind:'edit',id:'s1',fields:{...fields('climb',1200,3200),name:' Col choisi ',alerts:{beforeEnabled:true,beforeM:1000,atStart:true,atEnd:true}}})
    const segment=edited.stages[0].raceSegments[0],value=analyze(edited)
    assert.equal(segment.id,'s1');assert.equal(segment.name,'Col choisi');assert.equal(segment.type,'climb')
    close(value.distanceM,2000);assert.ok(value.elevationGainM>0);assert.ok(value.averageGradientPercent>0)
    assert.deepEqual(value.alertPoints.map(point=>point.offsetM),[200,1200,3200])
    const lanes=raceSegmentLanes(edited.stages[0].raceSegments)
    assert.notEqual(lanes[0].lane,lanes[1].lane)
    const touching=[{...segment,id:'a',startOffsetM:0,endOffsetM:10},{...segment,id:'b',startOffsetM:10,endOffsetM:20}]
    assert.deepEqual(raceSegmentLanes(touching).map(value=>value.lane),[0,0])
    assert.equal(validateTripBundle(edited).ok,true)
  }finally{database.close()}
})

test('a sub-metre segment inside a sparse GPX edge is valid and gets interpolated altitude statistics',async()=>{
  const {database,bundle}=await setup()
  try{
    const next=add(bundle,'tiny',fields('climb',1500,1500.1)),value=analyze(next)
    close(value.distanceM,.1,1e-8)
    assert.equal(value.geometry.length,2)
    assert.ok(value.geometry[1].altitudeM>value.geometry[0].altitudeM)
    assert.ok(value.averageGradientPercent>0)
    assert.equal(value.elevationGainM,0,'the shared 150 m smoothing flattens a sub-metre interval')
    assert.equal(value.status,'ready')
  }finally{database.close()}
})

test('unknown altitude remains unknown for segment ascent and gradient',async()=>{
  const {database,bundle}=await setup('league',false)
  try{const value=analyze(add(bundle,'s',fields('climb')));assert.equal(value.elevationGainM,null);assert.equal(value.averageGradientPercent,null);assert.equal(value.partialAltitude,true)}finally{database.close()}
})

test('alerts omit a pre-start point instead of fabricating 500 m, and no points are prepared outside course bounds',async()=>{
  const {database,bundle}=await setup()
  try{
    const fingerprint=buildRaceCourse(bundle,bundle.stages[0]).fingerprint
    let next=applyRaceBounds(bundle,bundle.stages[0].id,{routeFingerprint:fingerprint,startOffsetM:1500,finishOffsetM:6000},fingerprint,NOW)
    next=add(next,'near',fields('sprint',1600,2000))
    let value=analyze(next)
    assert.equal(value.beforeOmitted,true);assert.deepEqual(value.alertPoints.map(point=>point.offsetM),[1600])
    next=change(next,{kind:'edit',id:'near',fields:fields('sprint',2000,2500)})
    value=analyze(next);assert.deepEqual(value.alertPoints.map(point=>point.offsetM),[1500,2000])
    next=applyRaceBounds(next,next.stages[0].id,{routeFingerprint:fingerprint,startOffsetM:2100,finishOffsetM:6000},fingerprint,NOW)
    assert.equal(analyze(next).status,'outside-course');assert.deepEqual(analyze(next).alertPoints,[])
    assert.equal(next.stages[0].raceSegments.length,1,'bounds changes retain annotations for explicit review')
  }finally{database.close()}
})

test('map projection keeps repeated passes and parallel roads distinct, but a dense straight edge is one choice',async()=>{
  const {database,bundle}=await setup()
  try{
    const route=bundle.routes[0],stage=bundle.stages[0]
    const a={latitude:45,longitude:6,altitudeM:0},b={latitude:45.01,longitude:6,altitudeM:0}
    const loop={...bundle,routes:bundle.routes.map(value=>value.id===route.id?{...route,geometry:{full:[a,b,a,b],simplified:null}}:value)}
    const candidates=projectRacePosition(buildRaceCourse(loop,stage),{latitude:45.005,longitude:6})
    assert.equal(candidates.length,3)
    assert.ok(candidates[0].offsetM<candidates[1].offsetM&&candidates[1].offsetM<candidates[2].offsetM)
    const dense=projectRacePosition(buildRaceCourse(bundle,stage),{latitude:45.0055,longitude:6})
    assert.equal(dense.length,1)
    assert.deepEqual(projectRacePosition(buildRaceCourse(bundle,stage),{latitude:48,longitude:7}),[])
    const parallel={...loop,routes:loop.routes.map(value=>value.id===route.id?{...route,geometry:{full:[a,b,{...b,longitude:6.00005},{...a,longitude:6.00005}],simplified:null}}:value)}
    assert.equal(projectRacePosition(buildRaceCourse(parallel,stage),{latitude:45.005,longitude:6.000025}).length,2)
  }finally{database.close()}
})

test('invalid fields, duplicate ids and stale edit sessions roll back without changing saved segments',async()=>{
  const {database,bundle}=await setup()
  try{
    const next=add(bundle),repo=createTripRepository(database);await repo.saveTripBundle(next)
    for(const values of [{...fields(),name:' '},{...fields(),type:'unknown'},fields('climb',2000,1000),fields('climb',-1,10),fields('climb',0,1e9),fields('climb',NaN,20),{...fields(),alerts:{...DEFAULT_RACE_SEGMENT_ALERTS,beforeM:-1}}]){
      await assert.rejects(repo.updateTripBundle('segments',latest=>change(latest,{kind:'edit',id:'s1',fields:values})))
      assert.deepEqual((await repo.loadTripBundle('segments')).stages,next.stages)
    }
    assert.throws(()=>add(next,'s1'))
    assert.throws(()=>add(next,'s1',fields(),1),'ids are unique across parent stages')
    const old=buildRaceCourse(next,next.stages[0]).fingerprint
    const changed={...next,sourceFiles:next.sourceFiles.map(source=>({...source,sha256:'0'.repeat(64)}))}
    assert.throws(()=>applyRaceSegmentChange(changed,next.stages[0].id,{kind:'edit',id:'s1',fields:fields()},old,NOW),/parcours a changé/)
    const deleted=change(next,{kind:'delete',id:'s1'})
    assert.throws(()=>change(deleted,{kind:'edit',id:'s1',fields:fields()}),/supprimé/)
  }finally{database.close()}
})

test('bundle validation rejects forged nested segments, alerts, provenance and duplicate ids',async()=>{
  const {database,bundle}=await setup()
  try{
    const next=add(bundle)
    for(const mutate of [copy=>copy.stages[0].raceSegments='bad',copy=>copy.stages[0].raceSegments[0].alerts.atStart='yes',copy=>copy.stages[0].raceSegments[0].routeFingerprint='',copy=>copy.stages[0].raceSegments[0].provenance=null,copy=>copy.stages[1].raceSegments=copy.stages[0].raceSegments]){
      const copy=structuredClone(next);mutate(copy);assert.equal(validateTripBundle(copy).ok,false)
    }
  }finally{database.close()}
})

test('source replacement retains segments as stale, and explicit repositioning revalidates only the chosen segment',async()=>{
  const {database,bundle}=await setup()
  try{
    const next=add(add(bundle),'s2',fields('climb',3000,4000)),repo=createTripRepository(database)
    await repo.saveTripBundle(next)
    const draft=await loadTripEditDraft(database,'segments')
    const result=await editGpxTrip({database,tripId:'segments',slots:draft.slots.map((slot,i)=>i===0?{...slot,existingSourceFileId:null,file:file('replacement',47)}:slot),idFactory:createIdFactory('replacement'),now:()=>NOW})
    assert.equal(result.ok,true,result.message)
    assert.deepEqual(result.bundle.stages[0].raceSegments,next.stages[0].raceSegments)
    assert.equal(analyze(result.bundle).status,'stale');assert.equal(analyze(result.bundle).geometry,null)
    const fixed=change(result.bundle,{kind:'edit',id:'s1',fields:fields('flandrien',2000,3000)})
    assert.equal(analyze(fixed).status,'ready');assert.equal(analyze(fixed,0,1).status,'stale')
    assert.equal(validateTripBundle(fixed).ok,true)
  }finally{database.close()}
})

test('adding and reordering another League course preserves each retained segment and exact raw GPX',async()=>{
  const {database,bundle,files}=await setup()
  try{
    const next=add(bundle),repo=createTripRepository(database);await repo.saveTripBundle(next)
    const draft=await loadTripEditDraft(database,'segments')
    const result=await editGpxTrip({database,tripId:'segments',slots:[...draft.slots.map((slot,i)=>i===0?{...slot,eventDate:'2027-06-01',customName:'Renamed'}:slot),{kind:'ride',existingDayId:null,existingSourceFileId:null,file:file('new',48),eventDate:'2027-05-01',departureTime:'09:00'}],idFactory:createIdFactory('addition'),now:()=>NOW})
    assert.equal(result.ok,true,result.message)
    const stage=result.bundle.stages.find(stage=>stage.id===next.stages[0].id)
    assert.deepEqual(stage.raceSegments,next.stages[0].raceSegments)
    assert.equal(analyzeRaceSegment(buildRaceCourse(result.bundle,stage),stage.raceSegments[0]).status,'ready')
    const source=next.sourceFiles[0],payload=await createSourceFileRepository(database).getSourceFilePayload('segments',source.id)
    const bytes=payload.content instanceof Blob?await payload.content.arrayBuffer():payload.content
    assert.deepEqual(new Uint8Array(bytes),new Uint8Array(files[0].bytes))
  }finally{database.close()}
})

test('automatic climb sensitivity changes and reload never remove or move a manual Grimpeur',async()=>{
  const points=[{lat:45,lon:6,ele:200}]
  let distance=0,elevation=200
  for(const [length,grade] of [[2,-.5],[7,6],[5,-6],[1,4.5],[5,-3]])for(let i=0;i<Math.round(length/.05);i++){
    distance+=.05;elevation+=grade/100*50;points.push({lat:45,lon:6+distance/78.7,ele:elevation})
  }
  const hilly=toGpxImportFile(buildGpxXml({tracks:[{name:'Hilly',segments:[points]}]}),'hilly.gpx')
  const {database,bundle}=await setup('league',true,hilly)
  try{
    let next=add(bundle,'manual-climb',fields('climb',1000,2500))
    const expected=next.stages[0].raceSegments
    const counts=[]
    for(const sensitivity of ['mountain','flat','standard','flat']){
      next=applyClimbDetectionSensitivity(next,sensitivity,createIdFactory(sensitivity))
      counts.push(next.climbs.filter(climb=>climb.routeId===next.stages[0].sourceRouteId).length)
      assert.deepEqual(next.stages[0].raceSegments,expected)
      assert.equal(validateTripBundle(next).ok,true)
    }
    assert.ok(counts[1]>counts[0],'the automatic detector really changes its output on this GPX')
    const repo=createTripRepository(database);await repo.saveTripBundle(next)
    assert.deepEqual((await repo.loadTripBundle('segments')).stages[0].raceSegments,expected)
  }finally{database.close()}
})

test('switching Tour to Voyage hides competition tools and retains manual segments for the return to Tour',async()=>{
  const {database,bundle}=await setup('tour')
  try{
    const next=add(bundle),voyage=applyRaceMode(next,false)
    assert.deepEqual(voyage.stages[0].raceSegments,next.stages[0].raceSegments)
    assert.equal(buildRaceCourse(voyage,voyage.stages[0]),null)
    const tour=applyRaceMode(voyage,true)
    assert.deepEqual(tour.stages[0].raceSegments,next.stages[0].raceSegments)
    assert.equal(analyze(tour).status,'ready')
  }finally{database.close()}
})

test('profile silhouette previews never reread a long route geometry after its index is built',async()=>{
  const {database,bundle}=await setup()
  try{
    const next=add(bundle),route=next.routes[0]
    let reads=0
    const geometry=Array.from({length:10001},(_,i)=>({get latitude(){reads++;return 45+i*.0001},get longitude(){reads++;return 6},altitudeM:200}))
    const long={...next,routes:next.routes.map(value=>value.id===route.id?{...route,geometry:{full:geometry,simplified:null}}:value)}
    const course=buildRaceCourse(long,long.stages[0]);reads=0
    for(let i=0;i<200;i++)renderRaceSegmentProfile(course,[{...long.stages[0].raceSegments[0],endOffsetM:2000+i}], 'M20,200 L780,100', 'M20,200 L780,100 L780,214 L20,214Z')
    assert.equal(reads,0)
  }finally{database.close()}
})

test('full backup restore preserves segment ids, provenance, alert overrides and source GPX bytes',async()=>{
  const {database,bundle,files}=await setup()
  try{
    const next=add(bundle,'backup-segment',{...fields('flandrien'),alerts:{beforeEnabled:false,beforeM:1000,atStart:false,atEnd:true}})
    const repo=createTripRepository(database);await repo.saveTripBundle(next)
    const prepared=await prepareTripBackupRestore((await createTripBackup(database,NOW)).file)
    const ids=await restorePreparedTripBackup(database,prepared,createIdFactory('restore'),NOW)
    const restored=await repo.loadTripBundle(ids[0])
    assert.deepEqual(restored.stages[0].raceSegments,next.stages[0].raceSegments)
    assert.equal(analyze(restored).status,'ready')
    const payload=await createSourceFileRepository(database).getSourceFilePayload(ids[0],restored.sourceFiles[0].id)
    const bytes=payload.content instanceof Blob?await payload.content.arrayBuffer():payload.content
    assert.deepEqual(new Uint8Array(bytes),new Uint8Array(files[0].bytes))
  }finally{database.close()}
})

test('segments color the original profile silhouette with escaped names; no separate list or map controls',async()=>{
  const {database,bundle}=await setup()
  try{
    const next=add(add(bundle,'one',{...fields('sprint',1000,3000),name:'<img src=x onerror=alert(1)>'}),'two',fields('flandrien',2000,4000))
    const course=buildRaceCourse(next,next.stages[0]),segments=next.stages[0].raceSegments
    const profile=renderRaceSegmentProfile(course,segments,'M20,200 L780,100','M20,200 L780,100 L780,214 L20,214Z'),panel=renderRaceSegmentsPanel(course,next.stages[0])
    assert.match(profile,/stroke="#16804a"/);assert.match(profile,/fill="#e5bd32"/)
    assert.match(profile,/<clipPath/);assert.doesNotMatch(profile,/<img /);assert.match(profile,/&lt;img/)
    assert.doesNotMatch(panel,/race-segments__list|data-segment-map|<h3>Segments/)
    assert.match(panel,/step="0.1"/)
    const map=buildGenericRouteMapModel([],[])
    assert.equal(map.markers.length,0);assert.equal(map.segmentLines,undefined)
    const changed={...next,sourceFiles:next.sourceFiles.map(file=>({...file,sha256:'0'.repeat(64)}))}
    assert.doesNotMatch(renderRaceSegmentProfile(buildRaceCourse(changed,changed.stages[0]),segments,'',''),/data-profile-segment=/)
  }finally{database.close()}
})
