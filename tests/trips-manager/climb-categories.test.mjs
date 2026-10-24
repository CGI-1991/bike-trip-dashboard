import '../storage/indexeddb/support/setup-fake-indexeddb.mjs'
import '../ui/support/dom-shim.mjs'
import { installMinimalDOMParser } from '../support/minimal-dom-parser.mjs'
installMinimalDOMParser()
import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyClimb } from '../../src/analysis/climb-category.ts'
import { detectClimbs } from '../../src/analysis/climb-detection.ts'
import { applyClimbDetectionSettings } from '../../src/trips-manager/climb-sensitivity.ts'
import { applyTripPreferences, updateTripPreferences } from '../../src/trips-manager/trip-preferences.ts'
import { importGpxTrip } from '../../src/import/gpx/import-gpx-trip.ts'
import { buildGpxXml, toGpxImportFile } from '../import/gpx/support/fixtures.mjs'
import { createIdFactory, fixedNow, openImportTestDatabase } from '../import/gpx/support/run-import.mjs'
import { createTripRepository } from '../../src/storage/indexeddb/trip-repository.ts'
import { createLinkedTripBundle } from './support/linked-trip-fixture.mjs'
import { buildDayDetail } from '../../src/ui/trips/day-detail-view.ts'
import { buildRaceCourse } from '../../src/analysis/race-bounds.ts'
import { applyRaceSegmentChange } from '../../src/analysis/race-segments.ts'
import { validateTripBundle } from '../../src/trip-core/index.ts'
import { renderClimbSensitivitySlider } from '../../src/ui/trips/climb-sensitivity-slider.ts'

const NOW='2027-05-09T06:00:00.000Z'
const metric=(length,gain,grade=gain/length/10)=>({startDistanceKm:0,endDistanceKm:length,elevationGainM:gain,averageGradientPercent:grade})

test('cycling categories use complete length × net grade at each threshold; walking effort uses length + D+/100',()=>{
  for(const [i,score] of [8000,16000,32000,64000,80000].entries()){
    const climb=metric(2,score/100)
    assert.equal(classifyClimb(climb).rank,i+1)
    assert.equal(classifyClimb({...climb,averageGradientPercent:climb.averageGradientPercent-.000001}).rank,i)
  }
  assert.equal(classifyClimb(metric(.8,40)).label,'Côte')
  assert.equal(classifyClimb(metric(8,850)).label,'HC')
  assert.equal(classifyClimb(metric(1,100),'walking').label,'Effort 1/5')
  assert.equal(classifyClimb(metric(2,200),'walking').rank,2)
  assert.equal(classifyClimb(metric(4,400),'walking').rank,3)
  assert.equal(classifyClimb(metric(6,600),'walking').rank,4)
  assert.equal(classifyClimb(metric(10,1000),'walking').rank,5)
  assert.equal(classifyClimb(metric(0,100)),null)
  assert.equal(classifyClimb(metric(1,NaN)),null)
})

test('five category filters are nested and reversible without redetection, lost names, ids, overrides or manual climbs',()=>{
  const base=createLinkedTripBundle({rideCount:1}),routeId=base.routes[0].id
  const climbs=[40,100,200,400,650,850].map((gain,i)=>({id:`category-${i}`,routeId,name:`Col conservé ${i}`, ...metric(2,gain),maxGradientPercent:50,startAltitudeM:100,endAltitudeM:100+gain,confidence:'confirmed',provenance:{sourceType:'generated',sourceId:null,fetchedAt:null,engineVersion:'test',confidence:'high',manuallyOverridden:false}}))
  const manual={...climbs[0],id:'manual',provenance:{...climbs[0].provenance,sourceType:'user',manuallyOverridden:true}}
  const bundle={...base,climbs:[...climbs,manual],stages:base.stages.map(s=>({...s,climbIds:[...climbs.map(c=>c.id),manual.id]}))}
  let previous=bundle.stages[0].climbIds
  for(const minimum of [0,1,2,3,4]){
    const next=applyClimbDetectionSettings(bundle,'standard',minimum,()=>{throw Error('Category filtering must not redetect')})
    const ids=next.stages[0].climbIds
    assert.ok(ids.every(id=>previous.includes(id)))
    assert.equal(ids.length,7-minimum)
    assert.ok(ids.includes(manual.id))
    assert.equal(next.climbs,bundle.climbs)
    assert.equal(next.overrides,bundle.overrides)
    assert.equal(next.routes,bundle.routes)
    const all=applyClimbDetectionSettings(next,'standard',0,()=>{throw Error('Category reset must not redetect')})
    assert.deepEqual(all.stages[0].climbIds,bundle.stages[0].climbIds)
    previous=ids
  }
  const paused={...bundle,settings:{...bundle.settings,stages:[{stageId:bundle.stages[0].id,pausePlanMode:'custom',pauses:[{id:'keep-stop',active:true,routePointId:climbs[0].id,durationSeconds:600,order:0,origin:'custom'}]}]}}
  const filtered=applyClimbDetectionSettings(paused,'standard',4,()=>{throw Error('No redetection')})
  assert.ok(filtered.stages[0].climbIds.includes(climbs[0].id),'an explicit pause keeps its climb anchor despite the filter')
  assert.equal(filtered.settings.stages,paused.settings.stages)
})

function shortSteepProfile(){
  const profile=[]
  for(let i=0;i<=40;i++){
    const km=i*.01
    const elevation=km<=.1?100-km*20:km<=.3?98+(km-.1)*300:158-(km-.3)*300
    profile.push({distanceKm:km,elevationM:elevation,smoothedGradePercent:km<=.1?-2:km<=.3?30:-30,latitude:45+km/111.195,longitude:6})
  }
  return profile
}
test('walking detects a real 200 m steep ascent, cycling retains historical criteria, and noisy level ground stays empty',()=>{
  for(const sensitivity of ['standard','rolling','flat']){
    let serial=0
    const detect=(profile,mode)=>detectClimbs(profile,[],'route',()=>`id-${serial++}`,'test',sensitivity,mode)
    assert.equal(detect(shortSteepProfile(),'cycling').length,0)
    assert.equal(detect(shortSteepProfile(),'walking').length,1)
    const noise=shortSteepProfile().map((p,i)=>({...p,elevationM:100+Math.sin(i)*1.5,smoothedGradePercent:0}))
    assert.equal(detect(noise,'walking').length,0)
  }
})

async function fixture(){
  const points=[];let km=0,alt=200
  for(const [length,grade] of [[.5,-2],[.22,30],[.5,-13],[2,6],[.5,-4]]){
    for(let i=0;i<Math.round(length/.01);i++){
      points.push({lat:45+km/111.195,lon:6,ele:alt});km+=.01;alt+=grade*.1
    }
  }
  points.push({lat:45+km/111.195,lon:6,ele:alt})
  const database=await openImportTestDatabase(),xml=buildGpxXml({tracks:[{segments:[points]}]})
  const result=await importGpxTrip({database,files:[toGpxImportFile(xml,'climbs.gpx')],options:{tripId:'climbs',slug:'climbs',name:'Montées',organizationMode:'league',travelMode:'cycling',startDate:'2027-05-10',timezone:'Europe/Brussels',importedAt:NOW,engineVersion:'test'},dayStructure:[{kind:'ride',eventDate:'2027-05-10',departureTime:'08:00'}],idFactory:createIdFactory('climbs'),now:fixedNow(NOW)})
  assert.equal(result.ok,true,result.error?.message)
  const b=result.bundle,s=b.stages[0]
  const bundle=applyRaceSegmentChange(b,s.id,{kind:'add',id:'manual-sprint',fields:{name:'Sprint conservé',type:'sprint',startOffsetM:2000,endOffsetM:2400,alerts:{beforeEnabled:true,beforeM:500,atStart:true,atEnd:false}}},buildRaceCourse(b,s).fingerprint,NOW)
  await createTripRepository(database).saveTripBundle(bundle)
  return {database,bundle,xml}
}

test('changing sport recomputes walking climbs; category saves survive IndexedDB and retain all sources and manual segments',async()=>{
  const {database,bundle}=await fixture()
  try{
    const ids=createIdFactory('recomputed'),repository=createTripRepository(database)
    const walking=await updateTripPreferences({database,tripId:bundle.metadata.id,update:{travelMode:'walking',referenceSpeedKph:4.5},idFactory:ids,now:fixedNow(NOW)})
    assert.equal(walking.ok,true,walking.message)
    assert.ok(walking.bundle.climbs.length>bundle.climbs.length)
    const filtered=await updateTripPreferences({database,tripId:bundle.metadata.id,update:{climbCategoryMinimum:4},idFactory:ids,now:fixedNow(NOW)})
    assert.equal(filtered.ok,true,filtered.message)
    assert.equal(filtered.bundle.stages[0].climbIds.length,0)
    assert.deepEqual(filtered.bundle.climbs,walking.bundle.climbs)
    assert.deepEqual(filtered.bundle.stages[0].raceSegments,bundle.stages[0].raceSegments)
    assert.deepEqual(filtered.bundle.routes,bundle.routes)
    assert.deepEqual(filtered.bundle.sourceFiles,bundle.sourceFiles)
    const stored=await repository.loadTripBundle(bundle.metadata.id)
    assert.equal(stored.settings.global.climbCategoryMinimum,4)
    const all=applyTripPreferences(stored,{climbCategoryMinimum:0},NOW,ids)
    assert.deepEqual(all.stages[0].climbIds,walking.bundle.stages[0].climbIds)
    assert.equal(validateTripBundle(all).ok,true)
    assert.match(buildDayDetail(all,all.days[0].id).timelineHtml,/Effort [1-5]\/5|Petite montée/)
  }finally{database.close()}
})

test('invalid category settings cannot reach persistence or a restored bundle',async()=>{
  const {database,bundle}=await fixture()
  try{
    for(const minimum of [-1,5,1.5,'2',NaN]){
      const result=await updateTripPreferences({database,tripId:bundle.metadata.id,update:{climbCategoryMinimum:minimum},idFactory:createIdFactory(),now:fixedNow(NOW)})
      assert.equal(result.ok,false)
      assert.equal(validateTripBundle({...bundle,settings:{...bundle.settings,global:{...bundle.settings.global,climbCategoryMinimum:minimum}}}).ok,false)
    }
    assert.deepEqual(await createTripRepository(database).loadTripBundle(bundle.metadata.id),bundle)
  }finally{database.close()}
})

test('the five-position category control is separate from the retained advanced detection and names the active sport',()=>{
  for(const mode of ['cycling','walking']){
    const html=renderClimbSensitivitySlider('flat',3,mode)
    assert.match(html,/max="4" step="1" value="3" data-field="climb-category"/)
    assert.match(html,/<details[^>]*><summary>Détection avancée/)
    assert.match(html,/data-field="climb-sensitivity"/)
    assert.match(html,mode==='cycling'?/Cat. 2 et plus/:/Effort 3 et plus/)
  }
})
