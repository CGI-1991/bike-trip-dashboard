import test from 'node:test'
import assert from 'node:assert/strict'
import { aggregateProfileBands, profileBandCount } from '../../src/ui/profile-display-bands.ts'

test('a 150 km display bounds stripe count by screen width without changing the source samples',()=>{
  const source=Array.from({length:3000},(_,i)=>({startDistanceKm:i*.05,endDistanceKm:(i+1)*.05,averageGradientPercent:i%2?8:2}))
  const snapshot=JSON.stringify(source),narrow=aggregateProfileBands(source,320),wide=aggregateProfileBands(source,1100)
  assert.equal(narrow.length,profileBandCount(320));assert.ok(narrow.length<40)
  assert.ok(wide.length>narrow.length&&wide.length<=120)
  assert.equal(narrow[0].startDistanceKm,0);assert.equal(narrow.at(-1).endDistanceKm,150)
  assert.equal(JSON.stringify(source),snapshot)
})

test('colours weight distance rather than sample density, including split samples and partial bucket boundaries',()=>{
  const source=[{startDistanceKm:0,endDistanceKm:.1,averageGradientPercent:20},{startDistanceKm:.1,endDistanceKm:1,averageGradientPercent:0}]
  const dense=[...Array.from({length:100},(_,i)=>({startDistanceKm:i*.001,endDistanceKm:(i+1)*.001,averageGradientPercent:20})),source[1]]
  const integrated=rows=>rows.reduce((s,r)=>s+(r.endDistanceKm-r.startDistanceKm)*r.averageGradientPercent,0)
  assert.ok(Math.abs(integrated(aggregateProfileBands(source))-2)<1e-9)
  assert.ok(Math.abs(integrated(aggregateProfileBands(dense))-2)<1e-9)
})

test('missing altitude coverage remains unknown instead of borrowing a valid grade across a gap',()=>{
  const source=Array.from({length:100},(_,i)=>({startDistanceKm:i/100,endDistanceKm:(i+1)/100,averageGradientPercent:i<50?null:6}))
  const bands=aggregateProfileBands(source,180)
  assert.ok(bands.slice(0,10).every(b=>b.averageGradientPercent===null))
  assert.ok(bands.slice(10).every(b=>Math.abs(b.averageGradientPercent-6)<1e-9))
  assert.deepEqual(aggregateProfileBands([]),[])
})
