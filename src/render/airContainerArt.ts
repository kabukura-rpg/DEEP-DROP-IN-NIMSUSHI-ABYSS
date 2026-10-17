/**
 * AREA 3 AIR CONTAINER ART -- drawing only.
 *
 * One image from output/area3-air-container-art-v1/runtime (byte for byte): A / ANCIENT AIR RESERVOIR,
 * 34x34, one static state -- the sealed container (`broken: false`). Nothing else has an image: a
 * broken container keeps its procedural debris, and the bubbles are their own entities, drawn as before.
 *
 * The canvas is the container's own rectangle (`AIR_CONTAINER_RULES.size` square, top-left at the
 * AirContainer's x/y), so the image is laid 1:1 on exactly that rectangle. Nothing about the container
 * -- where it is laid, how big it is, what touching or shooting it does, where its bubbles come from --
 * is read from here.
 *
 * AREA 3 only, by place (`environmentArtArea`): THE ABYSS lays the same type (shot-only) in its staging
 * room and arena, and those keep the procedural box. Falls back to the procedural box when the image did
 * not load; never to some other image.
 */
import airContainerUrl from '../assets/air/area3-air-a-intact.png?url';
import { AIR_CONTAINER_RULES, type AirContainer } from '../data/structures';
import type { EnvironmentArtId } from './environmentArt';

export const AIR_CONTAINER_ART = airContainerUrl;
/** The image's canvas, as delivered: the container's footprint. */
export const AIR_CONTAINER_GEOMETRY = { width: AIR_CONTAINER_RULES.size, height: AIR_CONTAINER_RULES.size } as const;
export const AIR_CONTAINER_KEY = 'area3-air-container';

/** What the scene loads: [texture key, url]. */
export const airContainerLoads = (): [string, string][] => [[AIR_CONTAINER_KEY, AIR_CONTAINER_ART]];

/** The sealed container's key in AREA 3 when it loaded; otherwise null, and the box keeps its procedural drawing. */
export const airContainerArt = (area: EnvironmentArtId, exists: (key: string) => boolean) =>
  area === 3 && exists(AIR_CONTAINER_KEY) ? AIR_CONTAINER_KEY : null;

/** The image's top-left on screen: the procedural box's own `rect(box.x, box.y - cam)`, on whole pixels. */
export const airContainerPlacement = (box: AirContainer, cam: number) => ({ x: Math.round(box.x), y: Math.round(box.y - cam) });
