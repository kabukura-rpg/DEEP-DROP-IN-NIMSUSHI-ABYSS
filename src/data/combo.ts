/**
 * COMBO, as Downwell runs it.
 *
 * COMBO counts enemies defeated between touchdowns. It is NOT paid out the moment a number is
 * reached -- it is SETTLED when the player lands on ordinary ground, which is what makes a chain a
 * gamble: the longer it runs the more it is worth, and every extra kill is another chance to be hit
 * out of the air before it can be banked. Landing reads the current value, pays the tier it reached,
 * and returns COMBO to zero.
 *
 * Deliberately NOT reset by: taking damage, stomping an enemy, or crossing a SECTION / AREA / BOSS
 * boundary. Only a landing settles it.
 */
export interface ComboTier {
  /** Lowest COMBO that pays this tier. */
  at: number;
  /**
   * COIN paid in. The original pays a flat 100 Gems for any settled chain, and every tier here pays
   * the same 100 -- what deepens with the chain is what comes WITH the money, not the money. Paid
   * directly rather than scattered, so a banked chain can never be dropped on the floor and missed.
   */
  coins: number;
  /** Permanent Max Charge granted. Separate from the CHARGE module's +2. */
  maxCharge: number;
  /** Hearts handed to HealthSystem, so overflow and LIFE UP behave as they always do. */
  hearts: number;
  /** Short field label, e.g. shown as "12 COMBO · COIN". */
  label: string;
}

/**
 * Ordered shallowest first. A landing pays the DEEPEST tier it qualifies for and only that one, so
 * a 40-chain is worth the 25 tier once -- not the 8, the 15 and the 25 stacked together.
 */
export const COMBO_TIERS: readonly ComboTier[] = [
  { at: 8, coins: 100, maxCharge: 0, hearts: 0, label: '+100' },
  { at: 15, coins: 100, maxCharge: 1, hearts: 0, label: '+100 + CHARGE' },
  { at: 25, coins: 100, maxCharge: 1, hearts: 1, label: '+100 + CHARGE + LIFE' },
];

/** The tier a landing at this COMBO pays, or undefined when the chain was too short to bank. */
export const comboTierFor = (combo: number): ComboTier | undefined => {
  let paid: ComboTier | undefined;
  for (const tier of COMBO_TIERS) if (combo >= tier.at) paid = tier;
  return paid;
};

/** The shortest chain worth anything, for HUD hints and tests. */
export const COMBO_FIRST_TIER = COMBO_TIERS[0].at;
