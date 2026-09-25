/**
 * EXTERNAL TEST BUILD branding: the game's full name, and the small tag that tells a tester -- and
 * whoever reads their report -- exactly which build they played.
 *
 * `__BUILD_HASH__` is the short commit hash, written in by Vite at build time (vite.config.ts); a
 * build made outside a git checkout says `local` instead.
 */
export const TITLE = {
  main: 'DEEP DROP',
  sub: 'NIMUSHI ABYSS',
  document: 'DEEP DROP: NIMUSHI ABYSS',
} as const;

export const BUILD = {
  label: 'TEST BUILD',
  version: 'v0.1',
  hash: typeof __BUILD_HASH__ === 'string' && __BUILD_HASH__ ? __BUILD_HASH__ : 'local',
} as const;

/** `TEST BUILD v0.1 • abc1234` -- shown small on the title screen only. */
export const buildIdentifier = (build: { label: string; version: string; hash: string } = BUILD) =>
  `${build.label} ${build.version} • ${build.hash}`;
