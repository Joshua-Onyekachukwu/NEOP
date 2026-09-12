const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const LOG = path.join(process.cwd(), '_logs', `vercel-deploy-${Date.now()}.log`);
const OUT_JSON = path.join(process.cwd(), '_logs', `vercel-deploy-out-${Date.now()}.json`);

const logStream = fs.createWriteStream(LOG, { flags: 'a' });
function log(...args) { const s = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' '); logStream.write(s + '\n'); process.stdout.write(s + '\n'); }

const env = {
  ...process.env,
  VERCEL_TOKEN: 'vcp_X1iZx6mU4j5pT0f5y51rT4F40t2z',
  VERCEL_ORG_ID: 'team_ksBu4z76RQhxb2mFJHgsodAn',
  VERCEL_PROJECT_ID: 'prj_33UdRPH8dIn6Zet59kyAlGv29yeM',
  FORCE_COLOR: '0',
};

log('START whoami check');
const who = spawnSync('npx.cmd', ['--yes', 'vercel@latest', 'whoami', '--scope', 'joshua-onyekachukwus-projects'], {
  cwd: process.cwd(),
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
  timeout: 60000,
  shell: false,
});
log('whoami stdout:', (who.stdout||'').toString().trim());
log('whoami stderr:', (who.stderr||'').toString().trim());
log('whoami exit:', who.status);

log('');
log('=== START PREVIEW DEPLOY to ngeop (projectId=', env.VERCEL_PROJECT_ID, ') org=', env.VERCEL_ORG_ID, '===');

const child = spawn('npx.cmd', [
  '--yes', 'vercel@latest',
  'deploy',
  '-y',
  '--scope', 'joshua-onyekachukwus-projects',
  '--no-wait',
], {
  cwd: process.cwd(),
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
  shell: false,
});

let out = '', err = '';
child.stdout.on('data', d => { out += d.toString(); process.stdout.write(d); logStream.write('STDOUT: '+d.toString()); });
child.stderr.on('data', d => { err += d.toString(); process.stderr.write(d); logStream.write('STDERR: '+d.toString()); });

const t = setTimeout(() => { log('TIMEOUT after 15m'); process.exit(124); }, 15*60*1000);

child.on('close', code => {
  clearTimeout(t);
  log('=== DEPLOY CLOSED exit=' + code + ' ===');
  const lastOut = out.trim().split(/\r?\n/).filter(l => l.trim());
  const urlGuess = (out.match(/https:\/\/[^\s<>"']+/g) || []).slice(-5);
  const result = { exit: code, log: LOG, lastLines: lastOut.slice(-15), urls: urlGuess };
  fs.writeFileSync(OUT_JSON, JSON.stringify(result, null, 2));
  log('OUT_JSON:', OUT_JSON);
  log('Last lines:', JSON.stringify(lastLines.slice(-10), null, 2));
  log('URL guesses:', JSON.stringify(urlGuess, null, 2));
  logStream.end();
  process.exit(code === null ? 1 : code);
});
