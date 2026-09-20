import { BALANCE, type Stats } from '../data/balance';

/**
 * The tuning ranges. These are the limits of the LAB, not statements about balance.
 *
 * Gravity, move and fall were widened when video measurement of the original put its scale
 * equivalents at ~1680 / ~350 / ~930 -- above every one of the previous ceilings, which would have
 * made the comparison profile unreachable. A bound that cannot express the thing being tested is
 * not a safety feature.
 */
export const TUNING_FIELDS = [
  { key: 'gravity', label: 'Gravity', min: 400, max: 2000, step: 50 },
  { key: 'shotRecoil', label: 'Shot Recoil', min: 60, max: 350, step: 10 },
  { key: 'moveSpeed', label: 'Move Speed', min: 90, max: 400, step: 10 },
  { key: 'maxFallSpeed', label: 'Max Fall', min: 250, max: 1000, step: 20 },
  { key: 'maxAmmo', label: 'Ammo', min: 2, max: 12, step: 1 },
] as const;
export type TuningKey = typeof TUNING_FIELDS[number]['key'];
export type PhysicsTuning = Pick<Stats, TuningKey>;
export const TUNING_STORAGE_KEY = 'deep-drop-practice-physics-v1';
export function defaultTuning(): PhysicsTuning {
  return { gravity: BALANCE.gravity, shotRecoil: BALANCE.shotRecoil, moveSpeed: BALANCE.moveSpeed, maxFallSpeed: BALANCE.maxFallSpeed, maxAmmo: BALANCE.maxAmmo };
}
export function sanitizeTuning(value: unknown): PhysicsTuning {
  const result = defaultTuning();
  if (!value || typeof value !== 'object') return result;
  for (const field of TUNING_FIELDS) {
    const v = (value as Record<string, unknown>)[field.key];
    if (typeof v === 'number' && Number.isFinite(v)) result[field.key] = Math.round(Math.max(field.min, Math.min(field.max, v)));
  }
  return result;
}
export function loadTuning(storage?: Pick<Storage, 'getItem'>): PhysicsTuning {
  try { return sanitizeTuning(JSON.parse(storage?.getItem(TUNING_STORAGE_KEY) || 'null')); } catch { return defaultTuning(); }
}
export function saveTuning(value: PhysicsTuning, storage?: Pick<Storage, 'setItem'>) {
  try { storage?.setItem(TUNING_STORAGE_KEY, JSON.stringify(sanitizeTuning(value))); } catch { /* Session tuning works even when storage is unavailable. */ }
}
export const tuningVisible = (practice: boolean, mode: string) => practice && mode === 'playing';
