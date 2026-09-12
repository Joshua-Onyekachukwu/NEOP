const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = 'c:\\Users\\Administrator\\Webstrom\\NEOP';
process.chdir(ROOT);
const SCRIPT = path.join(ROOT, '_scripts', 'git-push-safe.cjs');
const LOG = path.join(ROOT, '_logs', 'spawn-git-push.log');

if (!fs.existsSync(path.dirname(LOG))) fs.mkdirSync(path.dirname(LOG), { recursive: true });
fs.writeFileSync(LOG, `starting spawn ${new Date().toISOString()}\nROOT=${ROOT}\nCWD=${process.cwd()}\nSCRIPT=${SCRIPT}\n`);

fs.appendFileSync(LOG, 'EXISTS SCRIPT? ' + fs.existsSync(SCRIPT) + '\n');

const env = { ...process.env };
try {
  const envLocal = fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8');
  envLocal.split(/\r?\n/).forEach(line => {
    const m = line.match(/^(GITHUB_TOKEN|GH_TOKEN)=(.+)$/);
    if (m) { env[m[1]] = m[2]; fs.appendFileSync(LOG, 'loaded ' + m[1] + ' (len=' + m[2].length + ') from root .env.local\n'); }
  });
  const envLocal2 = fs.readFileSync(path.join(ROOT, 'apps', 'web', '.env.local'), 'utf8');
  envLocal2.split(/\r?\n/).forEach(line => {
    const m = line.match(/^(GITHUB_TOKEN|GH_TOKEN)=(.+)$/);
    if (m && !env[m[1]]) { env[m[1]] = m[2]; fs.appendFileSync(LOG, 'loaded ' + m[1] + ' (len=' + m[2].length + ') from apps/web .env.local\n'); }
  });
} catch (e) { fs.appendFileSync(LOG, '.env.local read error (OK if not present): ' + String(e) + '\n'); }

fs.appendFileSync(LOG, `GITHUB_TOKEN=${env.GITHUB_TOKEN ? 'SET (len=' + env.GITHUB_TOKEN.length + ')' : 'NOT SET'}\n`);
fs.appendFileSync(LOG, `GH_TOKEN=${env.GH_TOKEN ? 'SET (len=' + env.GH_TOKEN.length + ')' : 'NOT SET'}\n`);

const child = spawn(process.execPath, [SCRIPT], {
  cwd: ROOT,
  env,
  shell: false,
  windowsHide: false,
});

child.stdout.on('data', d => fs.appendFileSync(LOG, 'STDOUTCHUNK: ' + d.toString()));
child.stderr.on('data', d => fs.appendFileSync(LOG, 'STDERRCHUNK: ' + d.toString()));
child.on('error', (e) => fs.appendFileSync(LOG, 'SPAWN ERROR: ' + String(e) + '\n'));
child.on('close', (code) => fs.appendFileSync(LOG, 'CLOSE exit=' + code + '\n'));
