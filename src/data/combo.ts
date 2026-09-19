/**
 * COMBO is the number of enemies defeated without touching down. Landing of any kind -- an ordinary
 * ledge, a BREAK FLOOR, an AREA 4 collapsing ledge -- resets it to zero, and so does taking damage.
 *
 * Reaching the threshold pays out once per chain, in the field, with no screen to dismiss: the run
 * never stops for it. The reward itself comes from this table rather than from a branch in the
 * model, so adding a third kind of payout is a line here.
 */
export const COMBO_RULES = {
  /** Kills in one chain that earn a reward. */
  rewardAt: 10,
} as const;

/**
 * What a chain pays. `bonus` is handed to exactly the same call a gun-module crate and a shop
 * purchase use, so a combo reward can never behave differently from the rest of the game:
 * `heart` goes through HealthSystem (and therefore through overflow and LIFE UP), `charge` grows
 * the magazine and refills it.
 */
export interface ComboReward {
  id: string;
  bonus: 'heart' | 'charge';
  /** Shown in the field label. */
  label: string;
}
export const COMBO_REWARDS: readonly ComboReward[] = [
  { id: 'life', bonus: 'heart', label: 'LIFE +1' },
  { id: 'ammo', bonus: 'charge', label: 'MAX AMMO +2' },
];

/**
 * Rewards rotate rather than roll. A player who strings two chains together gets two different
 * things, which is both more readable and completely deterministic -- no seed can hand out four
 * hearts in a row, and no test has to stub the generator to find out what it will get.
 */
export const comboRewardFor = (granted: number) => COMBO_REWARDS[((granted % COMBO_REWARDS.length) + COMBO_REWARDS.length) % COMBO_REWARDS.length];
