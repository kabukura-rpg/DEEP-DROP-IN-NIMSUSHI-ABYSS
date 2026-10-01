import { describe, expect, it } from 'vitest';
import indexHtml from '../index.html?raw';
import mainSource from '../src/main.ts?raw';
import titleSource from '../src/ui/titleScreen.ts?raw';
import { BUILD, TITLE, buildIdentifier } from '../src/ui/branding';
import { LEVEL_SELECT_DESTINATIONS, LEVEL_SELECT_GESTURE } from '../src/data/levelSelect';

/**
 * EXTERNAL TEST BUILD: what a tester sees when they open the URL. The page is DOM-built in main.ts,
 * so these read its source and its markup rather than a browser -- the browser checks are in the
 * pass report -- and pin the strings a tester's report will quote back.
 */
describe('title and build tag', () => {
  it('names the game DEEP DROP: NIMUSHI ABYSS, in the document and on the title screen', () => {
    expect(TITLE).toEqual({ main: 'DEEP DROP', sub: 'NIMUSHI ABYSS', document: 'DEEP DROP: NIMUSHI ABYSS' });
    expect(indexHtml).toContain(`<title>${TITLE.document}</title>`);
    // Concept C: the DEEP / DROP + NIMUSHI ABYSS logo image, with the same words as its text.
    expect(titleSource).toContain('<h2 class="title-logo"><img src="${TITLE_ASSETS.logo}" alt="" draggable="false"><span>${TITLE.main}<small>${TITLE.sub}</small></span></h2>');
    expect(mainSource).toContain('setOverlay(titleMarkup(audio.muted));');
  });

  it('tags the build as a TEST BUILD with its version and commit', () => {
    expect(BUILD.label).toBe('TEST BUILD');
    expect(BUILD.version).toBe('v0.1');
    expect(BUILD.hash).toMatch(/^([0-9a-f]{7,}|local)$/);
    expect(buildIdentifier({ label: 'TEST BUILD', version: 'v0.1', hash: 'abc1234' })).toBe('TEST BUILD v0.1 • abc1234');
    expect(titleSource).toContain('<span class="build-tag" id="build-tag">${buildIdentifier(build)}</span>');
    expect(titleSource).toContain('export function titleMarkup(muted: boolean, build = BUILD)');
  });
});

describe('an external tester', () => {
  it('starts at 1-1 from the ordinary START, and does not see LEVEL SELECT', () => {
    // START is the ordinary run; LEVEL SELECT is only added by the hidden gesture or ?levels.
    expect(mainSource).toContain("$('start').onclick = () => start();");
    expect(mainSource).not.toMatch(/<button id="level-select"/);
    expect(mainSource).toContain("if (new URLSearchParams(location.search).has('levels')) revealLevelSelect();");
  });

  it('keeps the hidden LEVEL SELECT exactly as it was: five taps (now on the title PLAYER), all 13 destinations', () => {
    expect(LEVEL_SELECT_GESTURE).toEqual({ taps: 5, windowMs: 2500 });
    expect(LEVEL_SELECT_DESTINATIONS).toHaveLength(13);
    // Counted on pointerup since the iOS touch fix (tests/touchGuards pins the counting itself).
    expect(mainSource).toContain('installLevelSelectGesture(player, revealLevelSelect, LEVEL_SELECT_GESTURE)');
  });
});
