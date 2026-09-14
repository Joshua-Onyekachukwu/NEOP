// One-off Vercel deployment cleanup for ngeop.
// KEEP:  current aliased production deployment + READY previews for the 5 most recent commits
// DELETE: ERROR/CANCELED deployments, superseded READY production deployments,
//         READY previews for commits older than the recent set.
const fs = require('fs');
const TOKEN = process.env.VT;
const TEAM = 'team_ksBu4z76RQhxb2mFJHgsodAn';
const RECENT = new Set(['3918686', '1f33126', '1c3f43b', '229d2ba', '51b2a85']);

const all = JSON.parse(fs.readFileSync('_logs/vx-deps-all.json', 'utf8')).deployments || [];
// Find current production = newest READY production with an alias assigned
const prodReady = all.filter(d => d.target === 'production' && d.state === 'READY');
const current = prodReady[0];

const keep = [], del = [];
for (const d of all) {
  const sha = (d.meta && d.meta.githubCommitSha || '').slice(0, 7);
  if (d.uid === current.uid) { keep.push([d, 'current production']); continue; }
  if (d.state === 'ERROR' || d.state === 'CANCELED') { del.push([d, d.state]); continue; }
  if (d.target === 'production' && d.state === 'READY') { del.push([d, 'superseded production']); continue; }
  // preview
  if (d.state === 'READY' && RECENT.has(sha)) { keep.push([d, 'recent preview ' + sha]); continue; }
  del.push([d, 'stale preview']);
}

console.log('KEEP:', keep.length, '| DELETE:', del.length);

(async () => {
  let ok = 0, fail = 0;
  for (const [d, why] of del) {
    try {
      const r = await fetch(`https://api.vercel.com/v13/deployments/${d.uid}?teamId=${TEAM}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      if (r.ok || r.status === 404) ok++;
      else { fail++; console.log('FAIL', d.uid, r.status, (await r.text()).slice(0, 100)); }
    } catch (e) { fail++; console.log('ERR', d.uid, e.message); }
    await new Promise(res => setTimeout(res, 120)); // pace the API
  }
  console.log(`deleted: ${ok}, failed: ${fail}`);
  const kept = keep.map(([d, why]) => `${d.uid.slice(0, 12)} ${why}`).join('\n  ');
  console.log('kept:\n  ' + kept);
})();
