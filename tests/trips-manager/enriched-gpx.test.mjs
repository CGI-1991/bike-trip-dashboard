import '../storage/indexeddb/support/setup-fake-indexeddb.mjs'
import '../ui/support/dom-shim.mjs'
import { installMinimalDOMParser } from '../support/minimal-dom-parser.mjs'
installMinimalDOMParser()
// Export reads source nodes and shallow root/extension shells only. Native XML
// serialization and namespace interoperability are also checked in Chromium.
globalThis.XMLSerializer=class { serializeToString(node){return node.rawXml} }
import test from 'node:test'
import assert from 'node:assert/strict'
import { importGpxTrip } from '../../src/import/gpx/import-gpx-trip.ts'
import { toGpxImportFile } from '../import/gpx/support/fixtures.mjs'
import { createIdFactory, fixedNow, openImportTestDatabase } from '../import/gpx/support/run-import.mjs'
import { createTripRepository } from '../../src/storage/indexeddb/trip-repository.ts'
import { applyRaceBounds, buildRaceCourse } from '../../src/analysis/race-bounds.ts'
import { applyRaceSegmentChange } from '../../src/analysis/race-segments.ts'
import { buildEnrichedGpx, enrichedGpxUnavailableReason } from '../../src/export/enriched-gpx.ts'
import { RACE_GPX_NAMESPACE, geometrySha256, validateEnrichedRace, xmlText } from '../../src/gpx/enriched-race-format.ts'
import { parseGpxXml } from '../../src/import/gpx/gpx-xml.ts'
import { preAnalyzeGpxFiles } from '../../src/trips-manager/pre-analysis.ts'
import { loadTripEditDraft, editGpxTrip } from '../../src/trips-manager/trip-editor.ts'
import { createEmptyWizardState, addFilesToState, setStructureCustomName } from '../../src/ui/trips/import-wizard-state.ts'
import { renderStageGpxActions } from '../../src/ui/trips/gpx-export-actions.ts'
import { validateTripBundle } from '../../src/trip-core/index.ts'
const NOW='2027-05-09T06:00:00.000Z'
const source=(lat=45)=>`<?xml version="1.0"?><gpx xmlns="http://www.topografix.com/GPX/1/1" xmlns:v="urn:vendor" version="1.1" creator="original"><metadata><name>Source</name></metadata><wpt lat="${lat}" lon="6"><name>Point &amp; origine</name></wpt><trk><name>Original</name><trkseg>${Array.from({length:201},(_,i)=>`<trkpt lat="${lat+i*.001}" lon="6"><ele>${200+i*3}</ele><time>2027-05-10T08:00:00Z</time><extensions><v:cadence>83</v:cadence></extensions></trkpt>`).join('')}</trkseg></trk><extensions><v:custom>Conservé &amp; inchangé</v:custom></extensions></gpx>`
async function imported(database,xml,{mode='league',id='source',dayStructure}={}) {
  return importGpxTrip({database,files:[toGpxImportFile(xml,`${id}.gpx`)],options:{tripId:id,slug:id,name:id,organizationMode:mode,startDate:'2027-05-10',timezone:'Europe/Brussels',importedAt:NOW,engineVersion:'test'},dayStructure:dayStructure??[{kind:'ride',eventDate:'2027-05-10',departureTime:'08:00'}],idFactory:createIdFactory(id),now:fixedNow()})
}
async function fixture(mode='league') {
  const database=await openImportTestDatabase(),xml=source(),result=await imported(database,xml,{mode})
  assert.equal(result.ok,true,result.error?.message)
  let bundle=result.bundle,stage=bundle.stages[0],fingerprint=buildRaceCourse(bundle,stage)?.fingerprint
  if(mode!=='voyage') {
    bundle=applyRaceBounds(bundle,stage.id,{routeFingerprint:fingerprint,startOffsetM:1000,finishOffsetM:20000},fingerprint,NOW)
    for(const [i,type] of ['sprint','climb','flandrien'].entries())bundle=applyRaceSegmentChange(bundle,stage.id,{kind:'add',id:`segment-${i}`,fields:{type,name:`${type} <&> é 🥾`,startOffsetM:1200+i*1000,endOffsetM:1800+i*1000,alerts:{beforeEnabled:true,beforeM:500,atStart:i!==1,atEnd:i===2}}},fingerprint,NOW)
    bundle={...bundle,stages:bundle.stages.map(stage=>({...stage,customName:'Course <&> Alpes 🚲'}))}
  }
  return {database,bundle,xml}
}
const configuration=stage=>({customName:stage.customName,bounds:stage.raceBounds?{startOffsetM:stage.raceBounds.startOffsetM,finishOffsetM:stage.raceBounds.finishOffsetM}:null,segments:(stage.raceSegments??[]).map(({id,type,name,startOffsetM,endOffsetM,alerts})=>({id,type,name,startOffsetM,endOffsetM,alerts}))})
for(const mode of ['league','tour'])test(`${mode}: enriched GPX round trip preserves geometry, real bounds, names, all segment types and alert overrides`,async()=>{
  const {database,bundle,xml}=await fixture(mode)
  try {
    const before=structuredClone(bundle),result=await buildEnrichedGpx(bundle,bundle.stages[0],xml)
    assert.deepEqual(bundle,before)
    assert.match(result.xml,/<time>2027-05-10T08:00:00Z<\/time>/)
    assert.match(result.xml,/<v:cadence>83<\/v:cadence>/)
    assert.match(result.xml,/<v:custom>Conservé &amp; inchangé<\/v:custom>/)
    assert.match(result.xml,/RACE_START/);assert.match(result.xml,/FLANDRIEN_01_START/)
    assert.doesNotMatch(result.xml,/SPRINT_01_ALERT/);assert.equal(result.warnings.length,1)
    assert.equal(parseGpxXml(result.xml).waypoints.length,1,'generated waypoints never become ordinary source POI/climb names')
    const reimported=await imported(database,result.xml,{mode,id:'copy'})
    assert.equal(reimported.ok,true,reimported.error?.message)
    assert.deepEqual(configuration(reimported.bundle.stages[0]),configuration(bundle.stages[0]))
    assert.deepEqual(reimported.bundle.routes[0].geometry.full,bundle.routes[0].geometry.full)
    assert.notEqual(reimported.bundle.stages[0].raceBounds.routeFingerprint,bundle.stages[0].raceBounds.routeFingerprint)
    assert.equal(buildRaceCourse(reimported.bundle,reimported.bundle.stages[0]).status,'bounded')
    assert.equal(validateTripBundle(reimported.bundle).ok,true)
    assert.deepEqual(configuration((await createTripRepository(database).loadTripBundle('copy')).stages[0]),configuration(bundle.stages[0]))
    const again=await buildEnrichedGpx(reimported.bundle,reimported.bundle.stages[0],result.xml)
    assert.equal((again.xml.match(/<tp:race /g)||[]).length,1)
    assert.equal((again.xml.match(/<tp:marker /g)||[]).length,10,'re-export replaces its own generated waypoints instead of accumulating duplicates')
    assert.equal((again.xml.match(/<v:custom>/g)||[]).length,1)
  }finally{database.close()}
})

test('a GPX changed externally is rejected before any import writes, and pre-analysis explains the mismatch',async()=>{
  const {database,bundle,xml}=await fixture()
  try {
    const output=(await buildEnrichedGpx(bundle,bundle.stages[0],xml)).xml.replace('lat="45.1"','lat="45.1001"')
    const before=await createTripRepository(database).listTrips()
    const result=await imported(database,output,{id:'tampered'})
    assert.equal(result.ok,false);assert.match(result.issues.map(issue=>issue.message).join(' '),/trace.*changé/i)
    assert.deepEqual(await createTripRepository(database).listTrips(),before)
    const [preview]=await preAnalyzeGpxFiles([toGpxImportFile(output,'tampered.gpx')])
    assert.equal(preview.status,'invalid');assert.match(preview.errorMessage,/trace.*changé/i)
  }finally{database.close()}
})

test('GPX defaults export without limits; stale/outside segments, mismatched source bytes and Voyage are rejected',async()=>{
  const {database,bundle,xml}=await fixture()
  try {
    const stage=bundle.stages[0],without={...bundle,stages:[{...stage,raceBounds:undefined}]}
    assert.equal(enrichedGpxUnavailableReason(without,without.stages[0]),null)
    assert.equal(parseGpxXml((await buildEnrichedGpx(without,without.stages[0],xml)).xml).enrichedRace.bounds,null)
    const stale={...bundle,stages:[{...stage,raceSegments:stage.raceSegments.map(segment=>({...segment,routeFingerprint:'old'}))}]}
    assert.match(enrichedGpxUnavailableReason(stale,stale.stages[0]),/segments/)
    const outside={...bundle,stages:[{...stage,raceBounds:{...stage.raceBounds,startOffsetM:1500}}]}
    assert.match(enrichedGpxUnavailableReason(outside,outside.stages[0]),/segments/)
    await assert.rejects(buildEnrichedGpx(bundle,stage,source(46)),/source GPX ne correspond/)
    const classic={...bundle,settings:{...bundle.settings,global:{...bundle.settings.global,organizationMode:'voyage',raceMode:false}}}
    assert.match(enrichedGpxUnavailableReason(classic,stage),/League ou Tour/)
  }finally{database.close()}
})

test('foreign extensions named race remain normal GPX; unsupported own versions and duplicate metadata are explicit failures',async()=>{
  const foreign=source().replace('<v:custom>','<v:race version="4">').replace('</v:custom>','</v:race>')
  assert.equal(parseGpxXml(foreign).enrichedRace,undefined)
  const {database,bundle,xml}=await fixture()
  try {
    const output=(await buildEnrichedGpx(bundle,bundle.stages[0],xml)).xml
    assert.throws(()=>parseGpxXml(output.replace('version="1"><tp:data>','version="2"><tp:data>')),/Version GPX enrichie/)
    assert.throws(()=>parseGpxXml(output.replaceAll(RACE_GPX_NAMESPACE,RACE_GPX_NAMESPACE.slice(0,-1)+'2')),/Version GPX enrichie/)
    const metadata=output.match(/<tp:race[\s\S]*?<\/tp:race>/)[0]
    assert.throws(()=>parseGpxXml(output.replace(metadata,metadata+metadata)),/dupliquées/)
    assert.throws(()=>parseGpxXml(output.replace(/<tp:data>[\s\S]*?<\/tp:data>/,'<tp:data>not-json</tp:data>')),/illisibles/)
  }finally{database.close()}
})

test('invalid intervals, duplicate ids, unsupported types and forged data cannot enter the bundle',async()=>{
  const {database,bundle,xml}=await fixture()
  try {
    const output=await buildEnrichedGpx(bundle,bundle.stages[0],xml),data=parseGpxXml(output.xml).enrichedRace,geometry=bundle.routes[0].geometry.full
    for(const invalid of [null,{}, {...data,bounds:{}},{...data,bounds:{startOffsetM:1000,finishOffsetM:999}},{...data,segments:[null]},{...data,segments:[data.segments[0],data.segments[0]]},{...data,segments:[{...data.segments[0],type:'fake'}]},{...data,segments:[{...data.segments[0],endOffsetM:30000}]}])await assert.rejects(validateEnrichedRace(invalid,geometry),/Configuration de course invalide/)
    assert.equal(await geometrySha256(geometry),data.geometrySha256)
    const withInjected={...data,settings:{global:{referenceSpeedKph:999}},segments:data.segments.map(segment=>({...segment,routeFingerprint:'forged'}))}
    const cleaned=await validateEnrichedRace(withInjected,geometry)
    assert.equal(cleaned.settings,undefined);assert.equal(cleaned.segments[0].routeFingerprint,undefined)
  }finally{database.close()}
})

test('regular import and Tour without explicit bounds remain supported; source names and alerts stay annotations in Voyage',async()=>{
  const {database,bundle,xml}=await fixture('tour')
  try {
    const full={...bundle,stages:bundle.stages.map(stage=>({...stage,raceBounds:undefined}))}
    const output=await buildEnrichedGpx(full,full.stages[0],xml)
    assert.doesNotMatch(output.xml,/RACE_START/)
    const result=await imported(database,output.xml,{id:'voyage-copy',mode:'voyage'})
    assert.equal(result.ok,true,result.error?.message)
    assert.equal(result.bundle.stages[0].raceBounds,undefined)
    assert.deepEqual(configuration(result.bundle.stages[0]),configuration(full.stages[0]))
    assert.equal(result.bundle.settings.global.organizationMode,undefined)
    const [preview]=await preAnalyzeGpxFiles([toGpxImportFile(output.xml,'copy.gpx')])
    assert.equal(preview.enrichedRace,true)
  }finally{database.close()}
})

test('structural editing keeps current manual changes and never resurrects deleted embedded limits or names',async()=>{
  const {database,bundle,xml}=await fixture()
  try {
    const output=(await buildEnrichedGpx(bundle,bundle.stages[0],xml)).xml
    const copy=await imported(database,output,{id:'live'})
    assert.equal(copy.ok,true)
    let live=copy.bundle,stage=live.stages[0]
    live=applyRaceBounds(live,stage.id,null,buildRaceCourse(live,stage).fingerprint,NOW)
    live=applyRaceSegmentChange(live,stage.id,{kind:'edit',id:'segment-0',fields:{...stage.raceSegments[0],name:'Nom modifié dans l’app'}},buildRaceCourse(live,live.stages[0]).fingerprint,NOW)
    live={...live,stages:live.stages.map(({customName,...stage})=>stage)}
    await createTripRepository(database).saveTripBundle(live)
    const draft=await loadTripEditDraft(database,'live')
    const edited=await editGpxTrip({database,tripId:'live',slots:draft.slots.map(slot=>({...slot,eventDate:'2027-06-01'})),idFactory:createIdFactory('rebuild'),now:()=>NOW})
    assert.equal(edited.ok,true,edited.message)
    assert.equal(edited.bundle.stages[0].raceBounds,undefined)
    assert.equal(edited.bundle.stages[0].customName,undefined)
    assert.deepEqual(edited.bundle.stages[0].raceSegments,live.stages[0].raceSegments)
    assert.equal(edited.bundle.days[0].date,'2027-06-01')
    assert.equal(validateTripBundle(edited.bundle).ok,true)
  }finally{database.close()}
})

test('adding an exported copy to the same League renews incoming collisions and leaves the original segment identities intact',async()=>{
  const {database,bundle,xml}=await fixture()
  try {
    await createTripRepository(database).saveTripBundle(bundle)
    const output=(await buildEnrichedGpx(bundle,bundle.stages[0],xml)).xml
    const draft=await loadTripEditDraft(database,'source')
    const edited=await editGpxTrip({database,tripId:'source',slots:[...draft.slots,{kind:'ride',existingDayId:null,existingSourceFileId:null,file:toGpxImportFile(output,'exported.gpx'),customName:bundle.stages[0].customName,eventDate:'2027-05-15',departureTime:'09:00'}],idFactory:createIdFactory('addition'),now:()=>NOW})
    assert.equal(edited.ok,true,edited.message)
    const original=edited.bundle.stages.find(stage=>stage.id===bundle.stages[0].id)
    assert.deepEqual(original.raceSegments,bundle.stages[0].raceSegments)
    const added=edited.bundle.stages.find(stage=>stage.id!==original.id)
    assert.equal(added.raceSegments.length,3)
    const all=edited.bundle.stages.flatMap(stage=>stage.raceSegments.map(segment=>segment.id))
    assert.equal(new Set(all).size,all.length)
    assert.deepEqual(added.raceSegments.map(({id,...segment})=>({...segment,routeFingerprint:undefined,provenance:undefined})),bundle.stages[0].raceSegments.map(({id,...segment})=>({...segment,routeFingerprint:undefined,provenance:undefined})))
    assert.equal(buildRaceCourse(edited.bundle,added).status,'bounded')
  }finally{database.close()}
})

test('enriched names are shown in the wizard before submission; explicit removal or replacement takes priority',async()=>{
  const {database,bundle,xml}=await fixture()
  try {
    const output=(await buildEnrichedGpx(bundle,bundle.stages[0],xml)).xml,file=toGpxImportFile(output,'copy.gpx')
    const state=createEmptyWizardState();state.organizationMode='league'
    await addFilesToState(state,{rawFiles:[{name:file.name,mimeType:file.mimeType,size:file.sizeBytes,lastModified:0,bytes:file.bytes}],idFactory:createIdFactory('wizard'),preAnalyzeFiles:preAnalyzeGpxFiles})
    assert.equal(state.structure[0].customName,bundle.stages[0].customName)
    setStructureCustomName(state,0,'')
    for(const [id,customName] of [['removed',state.structure[0].customName],['replaced','Choix explicite']]) {
      const result=await imported(database,output,{id,dayStructure:[{kind:'ride',customName,eventDate:'2027-05-10',departureTime:'08:00'}]})
      assert.equal(result.ok,true,result.error?.message)
      assert.equal(result.bundle.stages[0].customName,customName??undefined)
    }
  }finally{database.close()}
})

test('two adjacent exports follow live validity without a duplicate original GPX action',async()=>{
  const {database,bundle}=await fixture()
  try {
    const stage=bundle.stages[0]
    const actions=renderStageGpxActions(bundle,stage)
    assert.doesNotMatch(actions,/data-action="download-enriched-gpx" disabled/)
    assert.equal((actions.match(/data-action="download-/g)||[]).length,2)
    assert.match(actions,/course-exports__buttons/)
    assert.match(actions,/data-action="download-enriched-gpx">GPX<\/button>/)
    assert.match(actions,/data-feature-update="course-exports"/)
    assert.doesNotMatch(renderStageGpxActions(bundle,{...stage,raceBounds:undefined}),/data-action="download-enriched-gpx" disabled/)
    const stale={...stage,raceSegments:stage.raceSegments.map(segment=>({...segment,routeFingerprint:'obsolete'}))}
    assert.match(renderStageGpxActions(bundle,stale),/data-action="download-enriched-gpx" disabled/)
    assert.doesNotMatch(renderStageGpxActions(bundle,stale),/data-action="download-stage-gpx"/)
    assert.match(renderStageGpxActions(bundle,stale),/field__hint/)
  }finally{database.close()}
})

test('GPX 1.0 keeps its direct foreign-namespace extension form on import and re-export',async()=>{
  const {database,bundle,xml}=await fixture()
  try {
    const output=(await buildEnrichedGpx(bundle,bundle.stages[0],xml)).xml
    const legacy=output.replaceAll('http://www.topografix.com/GPX/1/1','http://www.topografix.com/GPX/1/0').replace('version="1.1"','version="1.0"').replace(/<\/?(?:extensions|metadata)(?:\s[^>]*)?>/g,'')
    const result=await imported(database,legacy,{id:'legacy'})
    assert.equal(result.ok,true,result.error?.message)
    assert.deepEqual(configuration(result.bundle.stages[0]),configuration(bundle.stages[0]))
    const again=await buildEnrichedGpx(result.bundle,result.bundle.stages[0],legacy)
    assert.match(again.xml,/version="1.0"/)
    assert.doesNotMatch(again.xml,/<extensions[\s>]/)
    assert.equal((again.xml.match(/<tp:race /g)||[]).length,1)
    assert.equal(parseGpxXml(again.xml).waypoints.length,1)
    assert.deepEqual(parseGpxXml(again.xml).enrichedRace,parseGpxXml(output).enrichedRace)
  }finally{database.close()}
})

test('prefixed GPX elements preserve their namespace and configuration',async()=>{
  const {database,bundle,xml}=await fixture()
  try {
    const output=(await buildEnrichedGpx(bundle,bundle.stages[0],xml)).xml
    const prefixed=output.replaceAll('xmlns="http://www.topografix.com/GPX/1/1"','xmlns:g="http://www.topografix.com/GPX/1/1"').replace(/(<\/?)(gpx|metadata|trkseg|trkpt|trk|wpt|name|ele|time|extensions|desc|type)(?=[\s>])/g,'$1g:$2')
    const result=await imported(database,prefixed,{id:'prefixed'})
    assert.equal(result.ok,true,result.error?.message)
    const again=await buildEnrichedGpx(result.bundle,result.bundle.stages[0],prefixed)
    assert.match(again.xml,/<g:gpx/);assert.match(again.xml,/<g:wpt lat=/)
    assert.equal(parseGpxXml(again.xml).waypoints.length,1)
    assert.deepEqual(configuration(result.bundle.stages[0]),configuration(bundle.stages[0]))
  }finally{database.close()}
})

test('unknown elevations and precise legacy offsets round trip without false zero altitudes or rounded segment limits',async()=>{
  const database=await openImportTestDatabase(),xml=source().replace(/<ele>[^<]*<\/ele>/g,'')
  try {
    const result=await imported(database,xml)
    assert.equal(result.ok,true,result.error?.message)
    let bundle=result.bundle,stage=bundle.stages[0],fingerprint=buildRaceCourse(bundle,stage).fingerprint
    bundle=applyRaceBounds(bundle,stage.id,{routeFingerprint:fingerprint,startOffsetM:1000,finishOffsetM:20000},fingerprint,NOW)
    bundle=applyRaceSegmentChange(bundle,stage.id,{kind:'add',id:'precise',fields:{type:'climb',name:'Côte sans altitude',startOffsetM:1100.125,endOffsetM:1100.625,alerts:{beforeEnabled:false,beforeM:0,atStart:false,atEnd:true}}},fingerprint,NOW)
    const output=await buildEnrichedGpx(bundle,bundle.stages[0],xml)
    assert.doesNotMatch(output.xml,/<ele>/)
    const copy=await imported(database,output.xml,{id:'no-altitude'})
    assert.equal(copy.ok,true,copy.error?.message)
    assert.deepEqual(configuration(copy.bundle.stages[0]),configuration(bundle.stages[0]))
    assert.ok(copy.bundle.routes[0].geometry.full.every(point=>point.altitudeM===null))
  }finally{database.close()}
})
