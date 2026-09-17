export const WORLD = { width: 450, height: 800, wall: 28, startY: 180, pixelsPerMeter: 24, chunkHeight: 960 };
export const BALANCE = { gravity: 900, moveSpeed: 180, maxFallSpeed: 520, shotRecoil: 190, maxAmmo: 6, maxHp: 4, shotDelay: 0.16, bounce: 210 };
export type Stats = typeof BALANCE & { power: number; bulletSize: number; piercing: boolean; comboBonus: number };
export const initialStats = (): Stats => ({ ...BALANCE, power: 1, bulletSize: 4, piercing: false, comboBonus: 0 });
