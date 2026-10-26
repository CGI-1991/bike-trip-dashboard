/** Ordinals use the saved stage ordering, shared by map, list and calendar. */
const COLORS=['#163f35','#ac7339','#3c7394','#8b5075','#547d36','#a44f3d','#466991','#786534'] as const
export function stageColor(index: number): string { return COLORS[Math.max(0,index)%COLORS.length]! }
