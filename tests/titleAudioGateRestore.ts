import RESTORE from './titleAudioGateRestore.json';

/**
 * TITLE AUDIO ENTRY GATE V1, put back out. The gate touched two existing sources -- main.ts (its
 * wiring) and ui/titleScreen.ts (the veil's markup) -- and added two of its own. Every hunk it added
 * is listed in titleAudioGateRestore.json as [the lines now, the lines at 03698bd], each anchored on
 * the line before it; reversing them gives 03698bd byte for byte (tests/titleAudioGate.test.ts).
 *
 * So the older "nothing else changed" pins keep their own digests: they are checked against the
 * source with the gate taken out, rather than re-pinned to whatever the source is now.
 */
export const TITLE_AUDIO_GATE_NEW_FILES = ['systems/TitleMusic.ts', 'ui/entryGate.ts'] as const;

/** `path` as any test spells it: '../src/main.ts', 'src/main.ts' or 'main.ts'. */
export function withoutTitleAudioGate(path: string, source: string) {
  const pairs = (RESTORE as unknown as Record<string, [string, string][]>)[path.replace(/^(\.\.\/)?(src\/)?/, '')];
  if (!pairs) return source;
  let restored = source;
  for (const [now, before] of pairs) {
    if (restored.split(now).length !== 2) throw new Error(`title audio gate hunk not found exactly once in ${path}: ${now.slice(0, 80)}`);
    restored = restored.replace(now, () => before);
  }
  return restored;
}

/** Whether a glob key ('../src/ui/entryGate.ts') is one of the gate's own new files. */
export const isTitleAudioGateFile = (path: string) => (TITLE_AUDIO_GATE_NEW_FILES as readonly string[]).includes(path.replace(/^(\.\.\/)?(src\/)?/, ''));
