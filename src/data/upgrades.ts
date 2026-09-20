/**
 * The original's twenty upgrades.
 *
 * DEEP DROP keeps its own names, labels and icons; what is aligned is what each one DOES. Every
 * entry here is data. None of them reaches into the simulation directly -- the model asks
 * `upgrades.has(id)` at the point the effect belongs to, so an upgrade is a rule the existing
 * systems read rather than a patch applied on top of them.
 *
 * Almost every number in `tuning` is PROVISIONAL / MEASUREMENT REQUIRED. The original's figures are
 * not published and have not been measured here; what is aligned is the mechanism. Anything that IS
 * documented -- Gem Powered's charge per gem, Member's Card's 10%, Knife and Fork's ten corpses --
 * is marked as such on the entry.
 */
export type UpgradeId =
  | 'apple' | 'blastModule' | 'candle' | 'drone' | 'gemAttractor'
  | 'gemPowered' | 'gemSick' | 'gunpowderBlocks' | 'heartBalloon' | 'hotCasing'
  | 'knifeAndFork' | 'laserSight' | 'membersCard' | 'poppingGems' | 'restInPieces'
  | 'reverseEngineering' | 'rocketJump' | 'safetyJetpack' | 'timeout' | 'youth';

export interface Upgrade {
  id: UpgradeId;
  /** The original's name, kept so the correspondence is legible. */
  origin: string;
  name: string;
  label: string;
  icon: string;
  description: string;
}

export const UPGRADES: readonly Upgrade[] = [
  { id: 'apple', origin: 'Apple', name: 'APPLE', label: 'りんご', icon: '🍎', description: 'HPを4回復。満タン分は余剰回復（LIFE UP）へ。' },
  { id: 'blastModule', origin: 'Blast Module', name: 'BLAST MODULE', label: '爆砕モジュール', icon: '💥', description: '踏みつけた瞬間、足元で爆発。周囲の敵とブロックを巻き込む。' },
  { id: 'candle', origin: 'Candle', name: 'CANDLE', label: 'ろうそく', icon: '🕯', description: '被弾後の無敵時間が延びる。' },
  { id: 'drone', origin: 'Drone', name: 'DRONE', label: 'ドローン', icon: '🛸', description: '随伴機が同時に撃つ。CHARGEは消費しない。' },
  { id: 'gemAttractor', origin: 'Gem Attractor', name: 'COIN MAGNET', label: '集金装置', icon: '🧲', description: 'COINを引き寄せる範囲が広がる。' },
  { id: 'gemPowered', origin: 'Gem Powered', name: 'COIN POWERED', label: 'コイン駆動', icon: '🔋', description: 'COINを拾うとCHARGEが回復。SMALL +1 / LARGE +5。' },
  { id: 'gemSick', origin: 'Gem Sick', name: 'COIN SICK', label: 'コイン中毒', icon: '🤑', description: 'COIN HIGH の持続が伸びる。' },
  { id: 'gunpowderBlocks', origin: 'Gunpowder Blocks', name: 'GUNPOWDER BLOCKS', label: '火薬ブロック', icon: '🧨', description: 'BREAK BLOCKが割れると上へ一発撃ち、隣へ誘爆する。' },
  { id: 'heartBalloon', origin: 'Heart Balloon', name: 'HEART BALLOON', label: 'ハート風船', icon: '🎈', description: '落下が遅くなる。敵が触れると爆発して消える。' },
  { id: 'hotCasing', origin: 'Hot Casing', name: 'HOT CASING', label: '排莢', icon: '🔥', description: '射撃のたび熱い薬莢が飛ぶ。敵にダメージ。' },
  { id: 'knifeAndFork', origin: 'Knife and Fork', name: 'KNIFE & FORK', label: 'ナイフとフォーク', icon: '🍴', description: '死体を食べられる。10体でHP +1。' },
  { id: 'laserSight', origin: 'Laser Sight', name: 'LASER SIGHT', label: '照準レーザー', icon: '🎯', description: '照準線が出て、弾の射程が伸びる。' },
  { id: 'membersCard', origin: "Member's Card", name: "MEMBER'S CARD", label: '会員証', icon: '💳', description: 'SHOPが10%引き。以降のSECTION序盤にSHOPが出る。' },
  { id: 'poppingGems', origin: 'Popping Gems', name: 'POPPING COINS', label: '弾けるコイン', icon: '✨', description: 'COINを拾うたび上へ一発撃つ。CHARGEは消費しない。' },
  { id: 'restInPieces', origin: 'Rest in Pieces', name: 'REST IN PIECES', label: '安らかに', icon: '☠', description: '死体を撃つと爆発する。' },
  { id: 'reverseEngineering', origin: 'Reverse Engineering', name: 'REVERSE ENGINEERING', label: '解析', icon: '🔧', description: 'GUN MODULEを撃つと中身を1度だけ引き直せる。' },
  { id: 'rocketJump', origin: 'Rocket Jump', name: 'ROCKET JUMP', label: 'ロケットジャンプ', icon: '🚀', description: '地上ジャンプが高くなり、足元で爆発する。' },
  { id: 'safetyJetpack', origin: 'Safety Jetpack', name: 'SAFETY JETPACK', label: '安全装置', icon: '🪂', description: 'CHARGE 0でも空中でACTIONを押すと降下が緩む。燃料制。' },
  { id: 'timeout', origin: 'Timeout', name: 'TIMEOUT', label: 'タイムアウト', icon: '⏳', description: '被弾した場所に時間停止の泡が残る。中にいる間、外の世界が止まる。' },
  { id: 'youth', origin: 'Youth', name: 'YOUTH', label: '若さ', icon: '🌱', description: 'HPを1回復。以降の強化の選択肢が4つになる。' },
];

export const upgrade = (id: UpgradeId) => UPGRADES.find(u => u.id === id)!;
export const UPGRADE_IDS = UPGRADES.map(u => u.id);

/**
 * Every tunable an upgrade owns, in one place.
 *
 * PROVISIONAL / MEASUREMENT REQUIRED unless the comment says otherwise: the original does not
 * publish these and none of them has been measured here. What the tests hold is the MECHANISM --
 * that a hit lasts longer, that a coin pays charge, that a chain reaction reaches the next block --
 * rather than any particular figure, so re-measuring later changes this table and nothing else.
 */
export const UPGRADE_TUNING = {
  apple: {
    /** DOCUMENTED: the original's apple heals four. */
    heal: 4,
  },
  blastModule: {
    /** Roughly three tiles across and four down, centred under the player's feet. */
    radius: 78,
    damage: 2,
    /** Dropped below the player, which is where the enemy they just stomped was. */
    offsetY: 26,
  },
  candle: {
    /** Multiplier on HealthSystem's own invulnerability window, never a rewrite of it. */
    invincibilityMultiplier: 1.5,
  },
  drone: {
    /** How far behind and above the player the companion rides. */
    offsetX: 26,
    offsetY: -30,
    /** How quickly it catches up, per second. */
    follow: 7,
  },
  gemAttractor: {
    /** Multiplier on CoinSystem's own magnet radius. */
    radiusMultiplier: 2.2,
  },
  gemPowered: {
    /**
     * DOCUMENTED in shape: a small gem pays 1 charge and a large one 5. DEEP DROP's coins are worth
     * 2 and 10, so this is value / 2 and the two line up exactly.
     */
    chargePerValue: 0.5,
  },
  gemSick: {
    /** Multiplier on how long a COIN HIGH lasts. Threshold and the boost itself are untouched. */
    durationMultiplier: 2,
  },
  gunpowderBlocks: {
    /** Chain reaction reach from a broken block to its neighbours. */
    chainRadius: 26,
  },
  heartBalloon: {
    /** Multiplier on fall speed while the balloon is alive. */
    fallMultiplier: 0.6,
    /** Where it rides, and how quickly it follows. */
    offsetY: -46,
    follow: 6,
    radius: 16,
    /** What it does when an enemy touches it. */
    blastRadius: 82,
    blastDamage: 3,
  },
  hotCasing: {
    /**
     * DOCUMENTED in shape: about half a machine gun round. The damage system carries this as a
     * fraction, so an HP 1 enemy takes two casings.
     */
    damageShare: 0.5,
    speed: 300,
    spread: 210,
    range: 260,
    size: 3,
  },
  knifeAndFork: {
    /** DOCUMENTED: ten corpses pay one heart. */
    corpsesPerHeart: 10,
    heal: 1,
  },
  laserSight: {
    /** Multiplier on a round's reach. Composes with COIN HIGH rather than replacing it. */
    rangeMultiplier: 1.5,
  },
  membersCard: {
    /** DOCUMENTED: ten percent off. */
    discount: 0.9,
    /** Metres into a SECTION the guaranteed shop chamber may be cut. */
    shopDepth: 24,
  },
  poppingGems: {
    /** The upward round a collected coin fires. Machine-class for both sizes for now. */
    speed: 640,
    range: 420,
    damage: 1,
    size: 4,
  },
  restInPieces: {
    blastRadius: 74,
    blastDamage: 2,
  },
  reverseEngineering: {
    /** One reroll per module, and no more. */
    rerollsPerModule: 1,
  },
  rocketJump: {
    /** Multiplier on the ground jump's impulse. */
    impulseMultiplier: 1.45,
    /** Roughly three tiles, centred under the feet that just left the floor. */
    blastRadius: 64,
    blastDamage: 2,
    blastOffsetY: 22,
  },
  safetyJetpack: {
    /** Seconds of hover. Sources differ between roughly three and five. */
    fuelSeconds: 4,
    /** Fall speed while hovering, as a share of the ordinary terminal speed. */
    fallMultiplier: 0.25,
  },
  timeout: {
    /** How big the stopped-time bubble a hit leaves behind is. */
    radius: 96,
  },
  youth: {
    /** DOCUMENTED in shape: a heart, and a fourth card from then on. */
    heal: 1,
    choices: 4,
  },
} as const;

/** How many cards a REST offers. Four once YOUTH is held, three before it. */
export const BASE_UPGRADE_CHOICES = 3;
