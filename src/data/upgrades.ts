import type { Stats } from './balance';
import type { HealthSystem } from '../systems/HealthSystem';
export type UpgradeCategory = 'attack' | 'ammo' | 'movement' | 'combo' | 'health';
export interface Upgrade {
  id: string; name: string; label: string; icon: string; description: string;
  category: UpgradeCategory; rarity: 'common' | 'rare'; stackable: boolean; maxStacks: number;
  apply: (stats: Stats, health: HealthSystem) => void;
  condition: (stats: Stats) => boolean;
}
const defaults = { rarity: 'common' as const, stackable: true, condition: (_: Stats) => true };
export const UPGRADES: Upgrade[] = [
  { ...defaults, id: 'mag', name: 'MAG+', label: '拡張マガジン', icon: '▥', category: 'ammo', maxStacks: 3, description: '最大弾数 +2（最大12発）。着地で補充。', condition: s => s.maxAmmo <= 10, apply: s => { s.maxAmmo += 2; } },
  { ...defaults, id: 'power', name: 'POWER+', label: '高出力弾', icon: '✦', category: 'attack', maxStacks: 2, description: '弾の威力 +1。硬い敵を少ない弾で。', condition: s => s.power < 3, apply: s => { s.power += 1; } },
  { ...defaults, id: 'recoil', name: 'RECOIL+', label: '反動ブースター', icon: '↑', category: 'movement', maxStacks: 2, description: '射撃反動 +15%。落下軌道を調整。', apply: s => { s.shotRecoil *= 1.15; } },
  { ...defaults, id: 'heart', name: 'HEART+', label: '予備ライフ', icon: '♡', category: 'health', maxStacks: Infinity, description: '最大HP +1。増えた1HPも回復済み。', apply: (_, health) => { health.lifeUp(); } },
  { ...defaults, id: 'speed', name: 'SPEED+', label: 'サイドスラスター', icon: '↔', category: 'movement', maxStacks: 3, description: '左右の移動速度 +10%。遠い足場へ。', apply: s => { s.moveSpeed *= 1.1; } },
  { ...defaults, id: 'big', name: 'BIG BULLET', label: '大口径弾', icon: '●', category: 'attack', maxStacks: 2, description: '弾の幅 +50%。動く敵を狙いやすく。', apply: s => { s.bulletSize *= 1.5; } },
  { ...defaults, id: 'piercing', name: 'PIERCING', label: '貫通弾', icon: '⇣', category: 'attack', rarity: 'rare', stackable: false, maxStacks: 1, description: '弾が複数の敵を貫通。一度だけ取得。', condition: s => !s.piercing, apply: s => { s.piercing = true; } },
  { ...defaults, id: 'bounce', name: 'BOUNCE', label: 'バウンドブーツ', icon: '⌁', category: 'movement', maxStacks: 2, description: '踏みつけの反発力 +25%。次の敵へ。', apply: s => { s.bounce *= 1.25; } },
  { ...defaults, id: 'combo', name: 'COMBO+', label: 'コンボアンプ', icon: '×', category: 'combo', maxStacks: Infinity, description: 'コンボ中のスコア倍率 +0.2。', apply: s => { s.comboBonus += 0.2; } },
  { ...defaults, id: 'food', name: 'FOOD', label: '携帯食', icon: '✚', category: 'health', maxStacks: Infinity, description: 'HP +4。余剰4ポイントで最大HP +1。', apply: (_, health) => { health.heal(4); } },
];
export function isUpgradeAvailable(upgrade: Upgrade, stats: Stats, stacks: Readonly<Record<string, number>> = {}) {
  return (stacks[upgrade.id] || 0) < (upgrade.stackable ? upgrade.maxStacks : 1) && upgrade.condition(stats);
}
/** Draw without replacement, preferring unused categories. Repeatable rewards prevent exhaustion. */
export function chooseUpgrades(stats: Stats, random = Math.random, stacks: Readonly<Record<string, number>> = {}) {
  const pool = UPGRADES.filter(u => isUpgradeAvailable(u, stats, stacks));
  const choices: Upgrade[] = [];
  while (choices.length < 3 && pool.length) {
    const diverse = pool.filter(u => !choices.some(c => c.category === u.category));
    const candidates = diverse.length ? diverse : pool;
    const next = candidates[Math.min(candidates.length - 1, Math.max(0, Math.floor(random() * candidates.length)))];
    choices.push(next); pool.splice(pool.indexOf(next), 1);
  }
  return choices;
}
