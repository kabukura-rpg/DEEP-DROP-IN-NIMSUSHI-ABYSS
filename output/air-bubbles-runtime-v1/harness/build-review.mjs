// build-review.mjs <kind> <out-dir>: one REVIEW build, the same transform as
// output/air-bubbles-visual-design-v1/harness/start.mjs (Codex), kept on disk instead of served and deleted.
//   codex : 5969f37 + start.mjs's hooks + its A/B branch in the AIR loop  (the Human Review environment, variant 'A')
//   base  : 5969f37 + the hooks only                                        (Current, no branch)
//   cand  : this worktree's src + the hooks only                            (Integrated A, no branch)
// The hooks only expose the scene (window.airReviewScene) and add review-game.js + the audit fixtures; the AIR draw
// code of `base` / `cand` is the shipped one. Production builds (dist/, builds/) are never touched by this.
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, symlink, writeFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const [kind, outDir] = process.argv.slice(2);
if (!['codex', 'base', 'cand'].includes(kind) || !outDir) throw Error('usage: build-review.mjs codex|base|cand <out>');
const harness = import.meta.dirname;
const worktree = path.resolve(harness, '../../..');
const baseline = '5969f37bbfb647b1a1a3a7413cec4654a0fafa27';
const temp = await mkdtemp(path.join(tmpdir(), `air-rt-review-${kind}-`));
try {
  if (kind === 'cand') {
    // The tracked art under output/ from HEAD, then this worktree's own sources on top.
    execFileSync('/usr/bin/git', ['archive', '-o', path.join(temp, 'head.tar'), 'HEAD', 'output'], { cwd: worktree });
    execFileSync('tar', ['-xf', path.join(temp, 'head.tar'), '-C', temp]);
    for (const f of ['src', 'public', 'package.json', 'index.html', 'tsconfig.json', 'vite.config.ts']) await cp(path.join(worktree, f), path.join(temp, f), { recursive: true });
  } else {
    const archive = path.join(temp, 'baseline.tar');
    execFileSync('/usr/bin/git', ['archive', '-o', archive, baseline, 'src', 'public', 'output', 'package.json', 'index.html', 'tsconfig.json', 'vite.config.ts'], { cwd: worktree });
    execFileSync('tar', ['-xf', archive, '-C', temp]);
  }
  await symlink(path.join(worktree, 'node_modules'), path.join(temp, 'node_modules'));
  const scene = path.join(temp, 'src/scenes/GameScene.ts');
  const original = await readFile(scene, 'utf8');
  const hook = '    this.graphics = this.worldFrontAir;\n';
  const current = '      this.graphics.lineStyle(2, 0x9fe8f5, fade).strokeCircle(bubble.x, by, 9);';
  if (original.split(hook).length !== 2) throw Error('AIR hook not found once');
  let patched = original.replace(hook, hook + "    (window as any).airReviewScene = this;\n    const airVariant = (window as any).airReviewVariant;\n");
  if (kind === 'codex') {
    if (original.split(current).length !== 2) throw Error('Unexpected AIR render source in pinned baseline');
    patched = "import { drawAirReview } from './air-art.js';\n" + patched.replace(current, "      if (airVariant === 'A' || airVariant === 'B') {\n        drawAirReview(this.graphics, bubble.x, by, fade, airVariant);\n        continue;\n      }\n" + current);
  } else {
    patched = patched.replace('    const airVariant = (window as any).airReviewVariant;\n', '');
  }
  await writeFile(scene, patched);
  // review-game.js imports rectCounts from ./scenes/air-art.js for describe(); in base/cand nothing draws with it.
  await copyFile(path.join(harness, 'air-art.js'), path.join(temp, 'src/scenes/air-art.js'));
  await copyFile(path.join(harness, 'review-game.js'), path.join(temp, 'src/review-game.js'));
  await copyFile(path.join(harness, 'audit-fixtures.js'), path.join(temp, 'src/audit-fixtures.js'));
  const index = path.join(temp, 'index.html');
  await writeFile(index, (await readFile(index, 'utf8')).replace('</body>', '<script type="module" src="/src/review-game.js"></script></body>'));
  execFileSync(process.execPath, [path.join(worktree, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', path.resolve(outDir), '--emptyOutDir'], {
    cwd: temp, stdio: 'inherit', env: { ...process.env, GITHUB_SHA: baseline },
  });
} finally {
  await rm(temp, { recursive: true, force: true });
}
