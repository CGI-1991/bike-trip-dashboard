// Re-export of the linked-stage fixture, so `tests/ui/*` reaches it by the
// same short path its own support modules use rather than crossing into
// `tests/trips-manager/support/` by hand.

export { createLinkedTripBundle, withLodging, withVillages } from '../../trips-manager/support/linked-trip-fixture.mjs'
export { withDayDepartureTime } from '../../../src/trips-manager/linked-stages.ts'
