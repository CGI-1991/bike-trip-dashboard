import test from 'node:test'
import assert from 'node:assert/strict'
import { syncCourseEditorProfile } from '../../src/ui/trips/course-editor-panel.ts'

function fixture() {
  const events=[],hosts=[{hidden:false},{hidden:false}]
  const home={append(node){node.parentElement=this}},target={append(node){node.parentElement=this}},panel={hidden:true}
  const profile={parentElement:home,dataset:{},draft:{start:1.2,end:2.8},querySelectorAll:()=>hosts,dispatchEvent:event=>events.push(event.type)}
  const nodes={'[data-day-detail-profile]':profile,'[data-day-profile-home]':home,'#day-bottom-panel-course':panel,'[data-course-profile-target]':target}
  return {profile,home,target,panel,hosts,events,container:{querySelector:selector=>nodes[selector]??null}}
}
test('Course borrows the exact reading profile and returns it home, preserving its state and pending form values',()=>{
  const {container,profile,panel,target,home,hosts,events}=fixture(),draft=profile.draft
  syncCourseEditorProfile(container)
  assert.equal(profile.parentElement,home);assert.ok(hosts.every(host=>host.hidden))
  panel.hidden=false;syncCourseEditorProfile(container)
  assert.equal(profile.parentElement,target);assert.ok(hosts.every(host=>!host.hidden));assert.equal(profile.dataset.courseEditing,'true')
  panel.hidden=true;syncCourseEditorProfile(container)
  assert.equal(profile.parentElement,home);assert.equal(profile.draft,draft);assert.deepEqual(profile.draft,{start:1.2,end:2.8})
  assert.deepEqual(events,['course-editor-changed','course-editor-changed','course-editor-hidden'])
  syncCourseEditorProfile(container);assert.equal(events.length,3)
})
test('classic Voyage and incomplete day shells remain valid without a Course editor',()=>{
  assert.doesNotThrow(()=>syncCourseEditorProfile({querySelector:()=>null}))
})
