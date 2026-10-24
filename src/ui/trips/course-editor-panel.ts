export function syncCourseEditorProfile(container: HTMLElement): void {
  const profile = container.querySelector<HTMLElement>('[data-day-detail-profile]')
  const home = container.querySelector<HTMLElement>('[data-day-profile-home]')
  const panel = container.querySelector<HTMLElement>('#day-bottom-panel-course')
  const target = container.querySelector<HTMLElement>('[data-course-profile-target]')
  if (profile === null || home === null || panel === null || target === null) return
  const editing = !panel.hidden
  const destination = editing ? target : home
  if (profile.parentElement !== destination) destination.append(profile)
  const previouslyEditing = profile.dataset.courseEditing === 'true'
  profile.dataset.courseEditing = String(editing)
  for (const host of profile.querySelectorAll<HTMLElement>('[data-race-course-host], [data-race-segments-host]')) host.hidden = !editing
  if (previouslyEditing !== editing) profile.dispatchEvent(new CustomEvent('course-editor-changed'))
  if (previouslyEditing && !editing) profile.dispatchEvent(new CustomEvent('course-editor-hidden'))
}
