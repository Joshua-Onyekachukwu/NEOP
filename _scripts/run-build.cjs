const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = 'c:\\Users\\Administrator\\Webstrom\\NEOP';
const LOG = path.join(ROOT, '_logs', 'p1-build-' + Date.now() + '.log');
const OUT_JSON = path.join(ROOT, '_logs', 'p1-build-out-' + Date.now() + '.json');
if (!fs.existsSync(path.dirname(LOG))) fs.mkdirSync(path.dirname(LOG), { recursive: true });

const log = (s) => {
  const t = (new Date().toISOString()) + ' ' + (typeof s === 'string' ? s : JSON.stringify(s, null, 2));
  fs.appendFileSync(LOG, t + '\n', 'utf8');
};

log('START build:web');
const child = spawn('npm.cmd', ['run', 'build:web'], {
  cwd: ROOT,
  shell: false,
  windowsHide: true,
});
let out='', err='';
child.stdout.on('data', d => { out += d.toString(); fs.appendFileSync(LOG, 'SOUT: ' + d.toString()); });
child.stderr.on('data', d => { err += d.toString(); fs.appendFileSync(LOG, 'SERR: ' + d.toString()); });
const to = setTimeout(() => { log('TIMEOUT 20m'); fs.writeFileSync(OUT_JSON, JSON.stringify({ timeout: true })); process.exit(124); }, 20*60*1000);
child.on('close', (code) => {
  clearTimeout(to);
  log('CLOSE exit=' + code);
  const last = (out + '\n' + err).split(/\r?\n/).filter(l => l.trim()).slice(-40);
  fs.writeFileSync(OUT_JSON, JSON.stringify({ exit: code, lastLines: last, log: LOG }, null, 2));
});
