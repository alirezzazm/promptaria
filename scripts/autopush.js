'use strict';
/**
 * Pushes any local commits to GitHub, unattended.
 *
 * Git's credential manager on this box needs a terminal to prompt, which a
 * scheduled task does not have — so the token is read from a file instead and
 * injected into the remote URL for the length of one push. The token file is
 * gitignored and never logged; only its last four characters are ever shown.
 *
 * Setup, once:
 *   1. GitHub → Settings → Developer settings → Personal access tokens
 *      → Fine-grained token, repo `promptaria`, permission Contents: Read+Write
 *   2. Save it to  .github-token  in the project root (one line, nothing else)
 *
 * After that `npm run maintain` pushes on its own.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TOKEN_FILE = path.join(ROOT, '.github-token');
const REPO = 'github.com/alirezzazm/promptaria.git';

const git = (args) =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function readToken() {
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN.trim();
  if (!fs.existsSync(TOKEN_FILE)) return null;
  const t = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
  return t || null;
}

function push(log = console.log) {
  let ahead = '';
  try {
    ahead = git(['log', '--oneline', 'origin/main..HEAD']);
  } catch (e) {
    // Worth printing: under the SYSTEM account this failed for a whole
    // different reason than a missing remote (git refused the repo as
    // dubious ownership), and the old message sent us looking in the wrong place.
    const why = String(e.stderr || e.message || '').split('\n')[0].slice(0, 160);
    log(`      cannot compare with origin — skipping push (${why})`);
    return { pushed: 0, reason: 'no-origin' };
  }

  const count = ahead ? ahead.split('\n').length : 0;
  if (!count) {
    log('      nothing to push');
    return { pushed: 0, reason: 'up-to-date' };
  }

  const token = readToken();
  if (!token) {
    log(`      ${count} commit(s) waiting — no token, add one to .github-token to push automatically`);
    return { pushed: 0, reason: 'no-token', waiting: count };
  }

  try {
    // The token lives only in this argv, never in a stored remote or the log.
    execFileSync('git', ['push', `https://x-access-token:${token}@${REPO}`, 'HEAD:main'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    log(`      pushed ${count} commit(s) (token …${token.slice(-4)})`);
    return { pushed: count };
  } catch (e) {
    // Never echo the command line back — it contains the token.
    const msg = String(e.stderr || e.message || '').replace(token, '***').split('\n')[0];
    log('      push failed: ' + msg.slice(0, 160));
    return { pushed: 0, reason: 'error' };
  }
}

module.exports = { push, readToken };

if (require.main === module) {
  const r = push();
  if (r.reason === 'no-token') process.exitCode = 2;
}
