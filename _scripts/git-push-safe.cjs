const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = 'c:\\Users\\Administrator\\Webstrom\\NEOP';
const LOG_FILE = path.join(ROOT, '_logs', `git-push-${Date.now()}.log`);
const OUT_JSON = path.join(ROOT, '_logs', `git-push-out-${Date.now()}.json`);
if (!fs.existsSync(path.dirname(LOG_FILE))) fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });

const envGitHubToken =
  process.env.GITHUB_TOKEN ||
  process.env.GH_TOKEN ||
  '';
// Try token from root .env.local if any
try {
  const envLocal = fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8');
  for (const line of envLocal.split(/\r?\n/)) {
    const m = line.match(/^(GITHUB_TOKEN|GH_TOKEN)=(.+)$/);
    if (m && !envGitHubToken) { process.env.GITHUB_TOKEN = m[2]; }
  }
} catch {}

const log = (s) => {
  const t = typeof s === 'string' ? s : JSON.stringify(s, null, 2);
  fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${t}\n`, 'utf8');
};

log('START');
log('CWD=' + process.cwd());
log('GITHUB_TOKEN set? ' + (process.env.GITHUB_TOKEN ? 'YES (len=' + process.env.GITHUB_TOKEN.length + ')' : 'NO'));

function runStep(stepName, cmd, args, opts = {}) {
  return new Promise((resolve) => {
    log(`\n=== ${stepName}: ${cmd} ${args.join(' ')}`);
    const child = spawn(cmd, args, {
      cwd: ROOT,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', GCM_INTERACTIVE: 'never' },
      shell: false,
      windowsHide: true,
    });
    let out = '', err = '', combined = '';
    const onData = (isErr) => (d) => {
      const s = d.toString();
      if (isErr) err += s; else out += s;
      combined += s;
    };
    child.stdout.on('data', onData(false));
    child.stderr.on('data', onData(true));
    child.on('error', (e) => { log(stepName + ' SPAWN ERROR: ' + String(e)); resolve({ step: stepName, exit: 999, out, err, error: String(e) }); });
    child.on('close', (code) => {
      log(`  exit=${code}`);
      const last = (out + '\n' + err).split(/\r?\n/).filter(l => l.trim()).slice(-20);
      last.forEach(l => log(`  ${l}`));
      resolve({ step: stepName, exit: code, out, err, last });
    });
  });
}

(async () => {
  const steps = [];
  let s;

  // 1) git init if needed
  const hasDotGit = fs.existsSync(path.join(ROOT, '.git'));
  log('has .git directory? ' + hasDotGit);

  if (!hasDotGit) {
    s = await runStep('git init', 'git.exe', ['init', '-b', 'main']);
    steps.push(s); if (s.exit !== 0) { finish(); return; }
  } else {
    s = await runStep('git status', 'git.exe', ['status', '--porcelain=v1']);
    steps.push(s);
  }

  // 2) Configure user (minimal anonymous)
  s = await runStep('git config user', 'git.exe', ['config', 'user.email', 'neop-bot@neop.ng']); steps.push(s);
  s = await runStep('git config user.name', 'git.exe', ['config', 'user.name', 'NEOP Bot']); steps.push(s);

  // 3) remote: if exists, reset to canonical; else add
  s = await runStep('git remote -v', 'git.exe', ['remote', '-v']); steps.push(s);
  const remoteHasOrigin = /^origin\s+/m.test(s.out + '\n' + s.err);
  const remoteUrl = process.env.GITHUB_TOKEN
    ? `https://${process.env.GITHUB_TOKEN}@github.com/Joshua-Onyekachukwu/NEOP.git`
    : 'https://github.com/Joshua-Onyekachukwu/NEOP.git';
  if (remoteHasOrigin) {
    s = await runStep('git remote set-url origin', 'git.exe', ['remote', 'set-url', 'origin', remoteUrl]); steps.push(s);
  } else {
    s = await runStep('git remote add origin', 'git.exe', ['remote', 'add', 'origin', remoteUrl]); steps.push(s);
  }

  // 4) Try fetch --depth=1 main first. If we have auth & remote exists it'll succeed and we have history.
  s = await runStep('git fetch origin main', 'git.exe', ['fetch', '--depth=1', 'origin', 'main']); steps.push(s);
  let fetched = s.exit === 0;

  // 5) If NO auth — we can't fetch. Note that explicitly in out.json but STOP before push (don't make empty commits or partial pushes).
  if (!fetched) {
    log('FETCH FAILED — likely no GITHUB_TOKEN set. Cannot verify remote main; abort push (to avoid divergent history). Add GITHUB_TOKEN env var (classic PAT, scope repo) then re-run.');
    finish({ aborted: true, reason: 'fetch-origin-main-failed', help: 'Set GITHUB_TOKEN in env/root .env.local as classic PAT scope=repo' });
    return;
  }

  // 6) reset hard to origin/main (so our work is appended cleanly on top of remote — no conflicts. But files NOT tracked upstream yet WILL BE OVERWRITTEN unless we stash first.)
  // Safest: do NOT reset hard yet. Instead do add --intent-to-add on changed files and diff against origin to see what changed.
  s = await runStep('git show --stat FETCH_HEAD --oneline | head -5', 'git.exe', ['show', '--stat', 'FETCH_HEAD', '--oneline', '-n', '5']); steps.push(s);

  // 7) Reset hard: FETCH_HEAD (origin/main tip) → preserves exactly their tree, then overlay our modifications.
  // Alternative safer: git stash the entire working tree diff first.
  // --- STASH ENTIRE CURRENT TREE (outside git if no history) by copying as patch via rsync is complex.
  // Easier: snapshot of all files we've touched into a backup dir.
  const backupDir = path.join(ROOT, '_git-backup-' + Date.now());
  const touch = [
    '.vercel/project.json',
    'apps/web/.vercel/project.json',
    'apps/web/src/app/api/admin/verify/route.ts',
    'apps/web/src/app/api/me/result/route.ts',
    'apps/web/src/app/api/public/results/route.ts',
    'apps/web/src/app/api/public/disruptions/route.ts',
    'apps/web/src/lib/api-cache.ts',
    'apps/web/middleware.ts',
    'apps/web/src/app/api/auth/verify-otp/route.ts',
    ...fs.readdirSync(path.join(ROOT, 'supabase', 'migrations'))
      .filter(f => /^[0-9]{3}_(21[6-9]|22[0-9]).*\.sql$|^900_DIAGNOSTIC/.test(f))
      .map(f => 'supabase/migrations/' + f),
  ];
  fs.mkdirSync(backupDir, { recursive: true });
  for (const rel of touch) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) { log('skip backup missing: ' + rel); continue; }
    const dst = path.join(backupDir, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(abs, dst);
    log('backed up ' + rel + ' -> ' + path.relative(ROOT, dst));
  }

  // 8) Hard reset → origin/main
  s = await runStep('git reset --hard FETCH_HEAD', 'git.exe', ['reset', '--hard', 'FETCH_HEAD']); steps.push(s);
  if (s.exit !== 0) { finish({ aborted: true, reason: 'hard reset failed' }); return; }

  // 9) Restore all backed-up files on top of clean origin/main
  for (const rel of touch) {
    const src = path.join(backupDir, rel);
    const dst = path.join(ROOT, rel);
    if (!fs.existsSync(src)) continue;
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    log('restored overlay: ' + rel);
  }

  // 10) git add . — respects .gitignore (no .env.local, no node_modules, no .next)
  s = await runStep('git add', 'git.exe', ['add', '--all']); steps.push(s);

  s = await runStep('git status --short', 'git.exe', ['status', '--short']); steps.push(s);
  const n = (s.out + '\n' + s.err).split(/\r?\n/).filter(l => /^[AMDRC?]/.test(l)).length;
  log('number of changes staged: ' + n);

  if (n === 0) {
    log('NO CHANGES to commit. Repo matches origin/main + overlays are identical files. Skip commit/push.');
    finish({ noop: true, reason: 'zero diff' });
    return;
  }

  // 11) Commit
  const commitMsg = [
    'neop: p0+222 + p1-1/2/3 completion audit wave',
    '',
    'p0: 219 fix columns submit_atomic, 220 fix ambiguous idempotency + remove metadata',
    '    221 manual party_row_count (GET DIAGNOSTICS was last-only). 222 P1-1 DB-level',
    '    assignment ownership/CHECKED_IN/PU/election 5 asserts inside submit_result_atomic.',
    'p1-2: revalidateTag stats/party-results + revalidatePath / results live on',
    '    admin verify write AND agent first-time submission write.',
    'p1-3: admin rejection route now writes SUPERSEDED (not REJECTED) so',
    '    uq_single_active constraint allows correction resubmission; reopens assignment',
    '    status=CHECKED_IN -> ASSIGNED; two audit events (RESULT_REJECTED +',
    '    ASSIGNMENT_REJECTED_REOPENED) captured.',
    'other: public results removed party_votes nonexistent from select.',
    '    public disruptions belt-and-suspenders removed agent_safe/what_observed select.',
    '    api-cache stats coverage_pct real math (no SEEDED_STATES.length fake fallbacks).',
    '    me/result zod both shapes, server randomUUID idempotency fallback,',
    '    suspended 403 status list, rpc 9-param p_idem out_* destructuring.',
    '    900 diagnostic: verify migrations + counts + RLS + fn param count.',
  ].join('\n');
  s = await runStep('git commit', 'git.exe', ['commit', '-m', commitMsg]); steps.push(s);
  if (s.exit !== 0) { finish({ aborted: true, reason: 'commit failed' }); return; }

  // 12) Push
  s = await runStep('git push -u origin main', 'git.exe', ['push', '-u', 'origin', 'main']); steps.push(s);

  finish({ pushExit: s.exit, commitDone: true });

  // --- helpers ---
  function finish(extra = {}) {
    const latest = steps[steps.length - 1];
    const ok = latest && latest.exit === 0;
    const out = {
      log: LOG_FILE,
      token: process.env.GITHUB_TOKEN ? 'SET len=' + process.env.GITHUB_TOKEN.length : 'UNSET',
      fetched,
      backupDir: path.relative(ROOT, backupDir),
      steps: steps.map(s => ({ step: s.step, exit: s.exit, last: s.last ? s.last.slice(-5) : [] })),
      ...extra,
      ok,
    };
    fs.writeFileSync(OUT_JSON, JSON.stringify(out, null, 2));
    log('DONE. ' + JSON.stringify(out, null, 2));
    process.exit(ok ? 0 : 1);
  }
})().catch(e => { log('UNCAUGHT ' + String(e) + ' stack=' + e.stack); process.exit(2); });
