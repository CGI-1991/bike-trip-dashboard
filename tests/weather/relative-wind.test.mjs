import assert from 'node:assert/strict'
import test from 'node:test'
import { indexRouteGeometry } from '../../src/route-enrichment/segment-geometry.ts'
import { buildRouteWindModel, combineRouteWindSummaries, headwindColor, relativeWindComponents, relativeWindLabel, smoothedTravelBearing } from '../../src/weather/relative-wind.ts'
import { formatRouteWindSummary, installProfileWindControls, renderRelativeWind, renderStageWindStat, selectProfileWind, updateProfileWind } from '../../src/ui/relative-wind-view.ts'

const point = km => ({latitude:45+km/111.195,longitude:6,altitudeM:100})
const line = (length=10, count=101) => Array.from({length:count},(_,i)=>point(i*length/(count-1)))
const forecast = (km, direction=0, speed=20, gusts=30) => ({samplePoint:{trackDistanceKm:km},state:'available',weather:{windSpeedKph:speed,windDirectionDeg:direction,windGustsKph:gusts}})
function modelFor(geometry=line(), direction=0, speed=20) {
  const length=indexRouteGeometry(geometry).lengthKm
  return buildRouteWindModel(geometry,[forecast(0,direction,speed),forecast(length,direction,speed)])
}
const close = (actual,expected,tolerance=0.01) => assert.ok(Math.abs(actual-expected)<tolerance,`${actual} != ${expected}`)

for(const [name,from,bearing,head,cross] of [
  ['northbound, north wind',0,0,20,0],
  ['northbound, south wind',180,0,-20,0],
  ['northbound, east wind',90,0,0,20],
  ['eastbound, north wind',0,90,0,-20],
  ['southbound, north wind',0,180,-20,0],
]) test(`${name}: physical face/tail and lateral components use the rider's frame`,()=>{
  const result=relativeWindComponents(20,from,bearing)
  close(result.headwindKph,head)
  close(result.crosswindKph,cross)
})

test('route heading is independent of phone orientation and smoothed along geometric distance',()=>{
  const north=indexRouteGeometry(line())
  close(smoothedTravelBearing(north,5),0)
  close(smoothedTravelBearing(north,0),0)
  const east=buildRouteWindModel([{latitude:0,longitude:179.999,altitudeM:0},{latitude:0,longitude:-179.999,altitudeM:0}],[forecast(0),forecast(0.223)])
  close(east.lengthKm,0.2224,0.001)
  close(east.at(east.lengthKm/2).crosswindKph,-20)
  assert.equal(smoothedTravelBearing(indexRouteGeometry([point(0),point(0)]),0),null)
})

test('the whole-route mean and exposure fractions are weighted by distance rather than vertex count',()=>{
  const sparse=modelFor(line(10,3))
  const dense=modelFor(line(10,10001))
  close(sparse.summary.mean.headwindKph,20)
  close(dense.summary.mean.headwindKph,20)
  close(dense.summary.headwindFraction,1)
  close(dense.summary.tailwindFraction,0)
  close(dense.summary.coveredFraction,1)
  assert.match(relativeWindLabel(dense.at(5)),/de face$/)
})

test('directions crossing north interpolate as vectors, never as raw degree averages',()=>{
  const geometry=line(),length=indexRouteGeometry(geometry).lengthKm
  const model=buildRouteWindModel(geometry,[forecast(0,359),forecast(length,1)])
  const reading=model.at(length/2)
  assert.ok(reading.relativeFromDeg<1||reading.relativeFromDeg>359)
  assert.ok(reading.headwindKph>19)
  close(reading.crosswindKph,0,0.1)
})

test('a U-turn cannot turn balanced face and tail exposure into calm weather',()=>{
  const geometry=[...line(5,101),...line(5,101).reverse().slice(1)]
  const model=modelFor(geometry)
  assert.equal(model.summary.mean.kind,'variable')
  close(model.summary.headwindFraction,0.5,0.02)
  close(model.summary.tailwindFraction,0.5,0.02)
  close(model.summary.mean.speedKph,20)
  assert.match(relativeWindLabel(model.summary.mean),/variable/)
})

test('calm wind without a direction remains calm, while missing direction at speed stays unknown',()=>{
  assert.equal(modelFor(line(),null,0).summary.mean.kind,'calm')
  assert.equal(modelFor(line(),null,20).summary.mean,null)
  assert.equal(modelFor(line(),Number.NaN,20).at(5),null)
  assert.equal(modelFor(line(),361,20).at(5),null)
})

test('missing forecast anchors are holes; neither extrapolation nor interpolation silently fills them',()=>{
  const geometry=line(),length=indexRouteGeometry(geometry).lengthKm
  const missing=buildRouteWindModel(geometry,[forecast(0),{...forecast(length/2),state:'unavailable',weather:null},forecast(length)])
  assert.equal(missing.summary.mean,null)
  assert.equal(missing.at(length/2),null)
  const partial=buildRouteWindModel(geometry,[forecast(2),forecast(8)])
  assert.equal(partial.at(1),null)
  assert.equal(partial.at(9),null)
  close(partial.summary.coveredFraction,0.6,0.02)
  const isolated=buildRouteWindModel(geometry,[forecast(0)])
  assert.match(relativeWindLabel(isolated.at(0)),/de face$/)
  assert.equal(isolated.at(1),null,'an isolated forecast never extends to the rest of the route')
  assert.equal(isolated.summary.coveredFraction,0)
})

test('opposed forecasts do not create a falsely favourable blue zone in an uncertain transition',()=>{
  const geometry=line(),length=indexRouteGeometry(geometry).lengthKm
  const model=buildRouteWindModel(geometry,[forecast(0,0),forecast(length,180)])
  assert.equal(model.at(length/2),null)
  assert.equal(headwindColor(model.at(length/2)),'#b7c0c7')
  assert.ok(model.summary.coveredFraction<0.9)
})

test('waypoint averaging uses a wider route window while retaining the wind direction relative to travel',()=>{
  const geometry=[point(0),point(5),{latitude:point(5).latitude,longitude:6.06,altitudeM:100}]
  const model=modelFor(geometry)
  const local=model.at(4.85,100),wide=model.at(4.85,1000)
  assert.ok(local.headwindKph>wide.headwindKph)
  assert.ok(Math.abs(wide.crosswindKph)>Math.abs(local.crosswindKph))
})

test('lateral gust components are explicit and missing gust data never becomes a zero reading',()=>{
  const model=modelFor(line(),90)
  close(model.summary.maximumCrosswindGustsKph,30)
  const geometry=line(),length=indexRouteGeometry(geometry).lengthKm
  const noGusts=buildRouteWindModel(geometry,[forecast(0,90,20,null),forecast(length,90,20,null)])
  assert.equal(noGusts.summary.maximumCrosswindGustsKph,null)
  const calm=modelFor(line(),null,0)
  assert.equal(calm.summary.maximumCrosswindGustsKph,null,'gust direction is not known when the mean wind is calm')
})

test('trip aggregation includes uncovered stages in its denominator and never averages angles directly',()=>{
  const head=modelFor(),tail=modelFor(line(),180)
  const stats=combineRouteWindSummaries([{lengthKm:10,summary:head.summary},{lengthKm:10,summary:tail.summary},{lengthKm:20,summary:null}])
  close(stats.coveredFraction,0.5)
  close(stats.headwindFraction,0.25)
  close(stats.tailwindFraction,0.25)
  assert.equal(stats.mean.kind,'variable')
  assert.match(formatRouteWindSummary(stats),/50 % du parcours/)
})

test('profile exploration never scans the full GPX again after model construction',()=>{
  let reads=0
  const geometry=line(100,10001).map(value=>({get latitude(){reads++;return value.latitude},get longitude(){reads++;return value.longitude},altitudeM:100}))
  const model=modelFor(geometry)
  reads=0
  for(let i=0;i<1000;i++)assert.ok(model.at(model.lengthKm*i/1000))
  assert.equal(reads,0)
})

test('unknown wind stays neutral gray; known headwind darkens a physical km/h scale and the rider remains upright',()=>{
  const strong=modelFor(line(),0,35).at(5)
  const tail=modelFor(line(),180,35).at(5)
  assert.notEqual(headwindColor(strong),headwindColor(tail))
  assert.match(renderRelativeWind(strong),/Vent de face/)
  assert.match(renderRelativeWind(tail),/Vent de dos/)
  assert.doesNotMatch(renderRelativeWind(null),/relative-wind__arrow/)
  assert.match(renderRelativeWind(strong),/rotate\(0\.0 32 32\)/)
})

test('walking wind uses a walker while retaining the same airflow direction in full and compact displays',()=>{
  const reading=modelFor(line(),180).at(5)
  for(const compact of [false,true]) {
    const cycling=renderRelativeWind(reading,compact)
    const walking=renderRelativeWind(reading,compact,'walking')
    assert.match(walking,/relative-wind__walker/)
    assert.doesNotMatch(cycling,/relative-wind__walker/)
    assert.match(walking,/Vent de dos/)
    assert.match(walking,/rotate\(180\.0 32 32\)/)
    assert.match(cycling,/rotate\(180\.0 32 32\)/)
  }
  assert.match(renderRelativeWind(null,false,'walking'),/Vent indisponible/)
  assert.doesNotMatch(renderRelativeWind(null,false,'walking'),/relative-wind__arrow/)
})

test('mobile wind shows total wind speed rather than its headwind component and omits the verbose breakdown',()=>{
  const reading=modelFor(line(),90,20).at(5)
  assert.ok(Math.abs(reading.headwindKph)<0.1)
  const markup=renderRelativeWind(reading,true)
  assert.match(markup,/20 km\/h/)
  assert.doesNotMatch(markup,/Face 0|latéral 20|rafales jusqu/)
  assert.match(markup,/relative-wind__bike/)
})

test('the profile retains walking orientation during exploration and restores cycling wording when the mode changes',()=>{
  const readout={innerHTML:''}
  const details={textContent:''}
  const elements={
    '[data-profile-interactive]':{},
    '[data-profile-color-bands]':{innerHTML:''},
    '.profile-area':{style:{}},
    '[data-profile-color-legend]':{textContent:''},
    '[data-profile-wind]':readout,
    '[data-route-wind-summary]':{textContent:''},
    '[data-selected-wind-details]':details,
  }
  const container={querySelector:selector=>elements[selector]??null,querySelectorAll:()=>[],addEventListener(){}}
  installProfileWindControls(container,[],{total:10,x:km=>km,y:altitude=>altitude})
  const model=modelFor()
  updateProfileWind(container,model,'walking')
  selectProfileWind(container,5)
  assert.match(details.textContent,/rafales jusqu’à 30 km\/h/)
  assert.doesNotMatch(readout.innerHTML,/rafales jusqu’à/)
  assert.doesNotMatch(readout.innerHTML,/data-stage-wind-average|Vent moyen du parcours/)
  assert.match(readout.innerHTML,/data-profile-selected-wind/)
  assert.match(readout.innerHTML,/sens de marche/)
  assert.match(readout.innerHTML,/relative-wind__walker/)
  assert.doesNotMatch(readout.innerHTML,/sens de roulage/)
  selectProfileWind(container,null)
  assert.equal(readout.innerHTML,'')
  updateProfileWind(container,model)
  selectProfileWind(container,5)
  assert.match(readout.innerHTML,/sens de roulage/)
  assert.doesNotMatch(readout.innerHTML,/relative-wind__walker/)
})

test('stage cardinal wind is independent from travel direction, including balanced face and tail on a U-turn',()=>{
  const north=modelFor(line(),45),south=modelFor(line().reverse(),45)
  close(north.meteorologicalMean.fromDeg,45)
  close(south.meteorologicalMean.fromDeg,45)
  close(north.meteorologicalMean.speedKph,south.meteorologicalMean.speedKph)
  const loop=modelFor([...line(5,101),...line(5,101).reverse().slice(1)])
  assert.equal(loop.summary.mean.kind,'variable')
  assert.equal(loop.meteorologicalMean.kind,'directional')
  close(loop.meteorologicalMean.fromDeg,0)
  close(loop.meteorologicalMean.speedKph,20)
})

test('cardinal direction crosses north using vectors and stage bounds exclude forecasts on access/return legs',()=>{
  const geometry=line(),length=indexRouteGeometry(geometry).lengthKm
  const north=buildRouteWindModel(geometry,[forecast(0,359),forecast(length,1)]).meteorologicalMean
  assert.ok(north.fromDeg<1||north.fromDeg>359)
  const bounded=buildRouteWindModel(geometry,[forecast(0,0,50),forecast(2,90,10),forecast(8,90,10),forecast(length,180,50)],{startKm:2,finishKm:8})
  close(bounded.meteorologicalMean.speedKph,10)
  close(bounded.meteorologicalMean.fromDeg,90)
  close(bounded.meteorologicalMean.coverage,1)
})

test('stage mean keeps unavailable coverage, calm and variable weather honest',()=>{
  assert.equal(modelFor(line(),null,20).meteorologicalMean,null)
  assert.equal(modelFor(line(),null,0).meteorologicalMean.kind,'calm')
  const geometry=line(),length=indexRouteGeometry(geometry).lengthKm
  const partial=buildRouteWindModel(geometry,[forecast(2),forecast(8)]).meteorologicalMean
  close(partial.coverage,.6,.02)
  assert.match(renderStageWindStat(partial),/partiel/)
  const variable=buildRouteWindModel(geometry,[forecast(0,0),forecast(length,180)]).meteorologicalMean
  assert.equal(variable.kind,'variable')
  assert.ok(variable.speedKph>1)
  assert.match(renderStageWindStat(variable),/variable/)
})

test('stage wind stat shows speed and French cardinal directions without a relative arrow or duplicate average',()=>{
  for(const [i,label] of ['N','NE','E','SE','S','SO','O','NO','N'].entries()) {
    const markup=renderStageWindStat({kind:'directional',fromDeg:i*45,speedKph:20.4,coverage:1})
    assert.match(markup,new RegExp(`>20 km/h · ${label}</span>`))
    assert.doesNotMatch(markup,/svg|de face|de dos/)
  }
  assert.match(renderStageWindStat(null),/indisponible/)
  assert.match(renderStageWindStat({kind:'calm',fromDeg:null,speedKph:0,coverage:1}),/>0 km\/h · calme/)
})

test('Course temporarily uses neutral without changing the saved reading mode, then restores it after weather updates',()=>{
  const previous=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),writes=[]
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:()=> 'wind',setItem:(...args)=>writes.push(args)}})
  try {
    const listeners={},controls={hidden:false},legend={hidden:false,textContent:''},area={style:{}},bands={innerHTML:''}
    const nodes={'[data-profile-interactive]':{},'[data-profile-color-bands]':bands,'.profile-area':area,'[data-profile-color-legend]':legend,'.profile-modes':controls}
    const container={dataset:{courseEditing:'false'},querySelector:key=>nodes[key]??null,querySelectorAll:()=>[],addEventListener:(name,handler)=>listeners[name]=handler}
    installProfileWindControls(container,[],{total:10,x:km=>km,y:altitude=>altitude})
    assert.equal(container.dataset.profileColorMode,'wind')
    container.dataset.courseEditing='true';listeners['course-editor-changed']()
    assert.equal(container.dataset.profileColorMode,'neutral');assert.equal(area.style.opacity,'1');assert.equal(controls.hidden,true);assert.equal(legend.hidden,true)
    updateProfileWind(container,modelFor())
    assert.equal(container.dataset.profileColorMode,'neutral')
    container.dataset.courseEditing='false';listeners['course-editor-changed']()
    assert.equal(container.dataset.profileColorMode,'wind');assert.equal(controls.hidden,false);assert.equal(area.style.opacity,'0')
    assert.deepEqual(writes,[])
  } finally {
    if(previous)Object.defineProperty(globalThis,'localStorage',previous);else delete globalThis.localStorage
  }
})

test('section wind averages the complete segment/climb interval and clips it to real course bounds',()=>{
  const geometry=line(),model=buildRouteWindModel(geometry,[forecast(0,0,10),forecast(5,0,20),forecast(10,0,30)],{startKm:2,finishKm:8})
  close(model.between(2,8).speedKph,20,.1)
  close(model.between(-10,100).speedKph,model.summary.mean.speedKph)
  close(model.between(3,5).speedKph,18,.2)
  assert.equal(model.between(0,1),null)
  assert.equal(model.between(8,12),null)
  assert.equal(model.between(5,5),null)
  assert.equal(model.between(NaN,6),null)
})
