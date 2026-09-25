/**
 * TEST LEVEL SELECT -- Human Review's way straight into any SECTION, or the ABYSS before the boss.
 *
 * Reached from the title by a hidden gesture (tap the title arrow five times) or `?levels` in the
 * URL; the ordinary START is untouched. A warp starts an ordinary fresh run and then moves it, so
 * HP, ammo and upgrades are a new run's; what a warp must also clear is the TRANSIENT state a jump
 * could otherwise carry across -- see `GameModel.warpTo`.
 */
import type { AreaId, SectionId } from './areas';

export type LevelDestination = `${AreaId}-${SectionId}` | 'boss';

export const LEVEL_SELECT_DESTINATIONS: readonly LevelDestination[] = [
  '1-1', '1-2', '1-3', '2-1', '2-2', '2-3', '3-1', '3-2', '3-3', '4-1', '4-2', '4-3', 'boss',
];

/** A destination as the model needs it, or null for anything that is not on the list. */
export function parseDestination(value: unknown): { area: AreaId; section: SectionId } | 'boss' | null {
  if (typeof value !== 'string' || !(LEVEL_SELECT_DESTINATIONS as readonly string[]).includes(value)) return null;
  if (value === 'boss') return 'boss';
  const [area, section] = value.split('-').map(Number);
  return { area: area as AreaId, section: section as SectionId };
}

/** How many taps on the title arrow open it, and inside what window. */
export const LEVEL_SELECT_GESTURE = { taps: 5, windowMs: 2500 } as const;
