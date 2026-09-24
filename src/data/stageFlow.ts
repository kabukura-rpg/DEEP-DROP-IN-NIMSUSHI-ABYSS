/**
 * STAGE GENERATION v2 -- THE FLOW PROFILE.
 *
 * WHY THIS EXISTS. PHASE 7C-1 measured DEEP DROP against Downwell footage and found the problem was
 * not any one AREA's mechanic but what the generator did with the enemies it already laid:
 *
 *   - 81-95% of AREA 1-3's enemies never came within 60px of a fall that simply followed the route,
 *     because every placement rule put them BESIDE the route: guards at the far end of a ledge,
 *     flyers "outside the entire envelope of this safe transfer";
 *   - so the route never asked for a shot (AREA 1-3 fired almost only at gate rows), the magazine
 *     was still 7.2-7.9 of 8 at every landing, stomp reloads were ~0 and an 8-chain ~never happened.
 *
 * A profile states, per SECTION, how the generator should put the enemies it was going to lay anyway
 * INTO the fall the player actually makes. It never adds an enemy: every roll that decides whether a
 * row has a guard or a flyer is untouched. What changes is where the one it rolled goes.
 *
 * WHAT IT MAY NOT DO -- checked by the generator on every placement, with the real physics:
 *
 *   - put anything on a landing spot, or inside a patrol that reaches one;
 *   - leave a fall with no way round an enemy: a PATH FLYER is only laid where the fall can steer
 *     clear of its whole movement AND still make the landing below (see `horizontalReach`);
 *   - demand a shot: going round, over or onto an enemy is always one of the answers.
 *
 * A plan without a profile generates exactly as it did before this file existed, down to the bit.
 */
export interface StageFlowProfile {
  /**
   * Share of air enemies laid ACROSS the fall between two rows, on the line from where the band above
   * lets the player off to where this row's landing is -- the line a fall that just follows the route
   * takes. Met in the air: shoot it, stomp it (a stompable one is a reload), or steer round it.
   */
  pathFlyers: number;
  /**
   * Share of ledge guards laid NEXT TO the landing instead of at the far end of the ledge: clear of
   * the spot a fall arrives at by a body and its whole patrol, so touching down is never a hit -- but
   * the guard is right there. Stomp it on the way in, shoot it from above, or step off at once.
   */
  landingGuards: number;
}
