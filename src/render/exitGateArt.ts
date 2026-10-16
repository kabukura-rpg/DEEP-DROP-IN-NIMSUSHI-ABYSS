/**
 * SECTION EXIT GATE ART -- drawing only.
 *
 * One image from deep-drop-exit-gate-art-production/outputs/runtime (byte for byte): A / ANCIENT LIFT
 * GATE, 86x74, one static state, shared by AREA 1-4. No per-AREA variant and no runtime tint.
 *
 * The canvas is the gate's own rectangle (`EXIT_RULES.width` x `EXIT_RULES.height`, the StageExit the
 * model tests the player against), so the image is laid 1:1 on exactly that rectangle: top-left at
 * the gate's top-left, bottom on the exit floor. Nothing about the gate -- where it stands, how big
 * it is, what touching it does -- is read from here.
 *
 * Falls back to the procedural gate when the image did not load; never to some other image.
 */
import exitGateUrl from '../assets/exit/exit-gate-common.png?url';
import { EXIT_RULES, type StageExit } from '../data/structures';

export const EXIT_GATE_ART = exitGateUrl;
/** The image's canvas, as delivered: the gate's footprint. */
export const EXIT_GATE_GEOMETRY = { width: EXIT_RULES.width, height: EXIT_RULES.height } as const;
export const EXIT_GATE_KEY = 'exit-gate-common';

/** What the scene loads: [texture key, url]. */
export const exitGateLoads = (): [string, string][] => [[EXIT_GATE_KEY, EXIT_GATE_ART]];

/** The gate's key when it loaded; otherwise null, and the gate keeps its procedural drawing. */
export const exitGateArt = (exists: (key: string) => boolean) => exists(EXIT_GATE_KEY) ? EXIT_GATE_KEY : null;

/** The image's top-left on screen: the procedural gate's own `rect(e.x, e.y - cam)`, rounded as it rounds. */
export const exitGatePlacement = (e: StageExit, cam: number) => ({ x: Math.round(e.x), y: Math.round(e.y - cam) });
