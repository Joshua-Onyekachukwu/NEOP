require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = 'c:\\Users\\Administrator\\Webstrom\\NEOP';
const LOG_DIR = path.join(ROOT, '_logs');
const LOG_FILE = path.join(LOG_DIR, 'ng-deploy-' + Date.now() + '.log');
const OUT_FILE = path.join(LOG_DIR, 'ng-deploy-out-' + Date.now() + '.json');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

const lg = (s) => {
  const t = (new Date().toISOString()) + ' ' + (typeof s === 'string' ? s : JSON.stringify(s, null, 2));
  fs.appendFileSync(LOG_FILE, t + '\n', 'utf8');
  console.log(t);
};

lg('START');
lg('ROOT=' + ROOT);

process.env.VERCEL_TOKEN = 'vcp_X1iZx6mU4j5pT0f5y51rT4F40t2z';
process.env.VERCEL_ORG_ID = 'team_ksBu4z76RQhxb2mFJHgsodAn';
process.env.VERCEL_PROJECT_ID = 'prj_33UdRPH8dIn6Zet59kyAlGv29yeM';
process.env.FORCE_COLOR = '0';
process.env.CI = '1';

lg('Env set');
lg('VERCEL_ORG_ID=' + process.env.VERCEL_ORG_ID);
lg('VERCEL_PROJECT_ID=' + process.env.VERCEL_PROJECT_ID);

const { spawnSync, spawn } = require('child_process');

lg('--- WHOAMI ---');
const w = spawnSync('npx.cmd', [
  '--yes', 'vercel@latest', 'whoami', '--scope', 'joshua-onyekachukwus-projects'
], { cwd: ROOT, shell: false, timeout: 180000, encoding: 'utf8', maxBuffer: 10*1024*1024 });
lg('whoami exit=' + w.status);
lg('whoami stdout: ' + (w.stdout||'').toString().substring(0,2000));
lg('whoami stderr: ' + (w.stderr||'').toString().substring(0,2000));

lg('--- LS (ngeop deployments) ---');
const l = spawnSync('npx.cmd', [
  '--yes', 'vercel@latest', 'ls', '--scope', 'joshua-onyekachukwus-projects', '--project', 'ngeop', '--format', 'json'
], { cwd: ROOT, shell: false, timeout: 180000, encoding: 'utf8', maxBuffer: 20*1024*1024 });
lg('ls exit=' + l.status);
lg('ls stdout: ' + (l.stdout||'').toString().substring(0,5000));
lg('ls stderr: ' + (l.stderr||'').toString().substring(0,3000));

lg('--- DEPLOY PREVIEW (no-wait) ---');
fs.writeFileSync(OUT_FILE, JSON.stringify({ started: new Date().toISOString() }, null, 2));

const dep = spawn('npx.cmd', [
  '--yes', 'vercel@latest', 'deploy',
  '-y',
  '--scope', 'joshua-onyekachukwus-projects',
  '--no-wait'
], { cwd: ROOT, shell: false, windowsHide: true });

let outA='', errA='';
dep.stdout.on('data', d => { outA += d.toString(); fs.appendFileSync(LOG_FILE, 'OUT: ' + d.toString()); });
dep.stderr.on('data', d => { errA += d.toString(); fs.appendFileSync(LOG_FILE, 'ERR: ' + d.toString()); });

const to = setTimeout(() => { lg('TIMEOUT 15m'); fs.appendFileSync(LOG_FILE, 'TIMEOUT after 15m\n'); process.exit(2); }, 15*60*1000);
dep.on('close', (code) => {
  clearTimeout(to);
  lg('DEPLOY exit=' + code);
  const urls = (outA + '\n' + errA).match(/https:\/\/[^\s<>"']+/g) || [];
  const last10 = (outA + '\n' + errA).split(/\r?\n/).filter(l => l.trim()).slice(-20);
  const result = {
    finishedAt: new Date().toISOString(),
    exit: code,
    logFile: LOG_FILE,
    urls,
    lastLines: last10,
    stdout: outA.substring(0, 20000),
    stderr: errA.substring(0, 20000),
  };
  fs.writeFileSync(OUT_FILE, JSON.stringify(result, null, 2));
  lg('RESULT written to ' + OUT_FILE);
  lg('URLS found: ' + JSON.stringify(urls));
  process.exit(code === null ? 1 : code);
});
