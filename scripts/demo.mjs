// Loads the demo database (mmf_demo) and starts the API and web app against it.
//   npm run demo          load fresh demo data, then start both servers
//   npm run demo:load     load fresh demo data only
//   npm run demo:start    start both servers against the data already loaded
// The dev databases (mmf, mmf_local) are never touched.
import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const base = process.env.DATABASE_URL ?? 'postgres://mmf:mmf_dev_only@localhost:5442/mmf';
const demoUrl = base.replace(/\/[^/]+$/, '/mmf_demo');
const adminUrl = base.replace(/\/[^/]+$/, '/postgres');
const env = { ...process.env, DATABASE_URL: demoUrl, NODE_ENV: 'development' };

async function load() {
  console.log('Starting Postgres (docker compose)...');
  execFileSync('docker', ['compose', 'up', '-d', '--wait', 'db'], { stdio: 'inherit' });
  const pg = require('pg');
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query('DROP DATABASE IF EXISTS mmf_demo WITH (FORCE)');
  await admin.query('CREATE DATABASE mmf_demo');
  await admin.end();
  console.log('Loading demo data into mmf_demo...');
  execFileSync('npm', ['run', 'seed:demo', '-w', '@mmf/api'], { stdio: 'inherit', env, shell: true });
}

function start() {
  const children = [
    spawn('npm', ['run', 'dev', '-w', '@mmf/api'], { stdio: 'inherit', env: { ...env, PORT: '4000' }, shell: true }),
    spawn('npm', ['run', 'dev', '-w', '@mmf/web'], { stdio: 'inherit', env: { ...env, API_URL: 'http://127.0.0.1:4000' }, shell: true }),
  ];
  console.log('\nDemo running: open http://127.0.0.1:5173  (API on :4000, database mmf_demo). Press Ctrl+C to stop.\n');
  const stop = () => {
    for (const c of children) {
      if (c.pid === undefined) continue;
      try {
        if (process.platform === 'win32') execFileSync('taskkill', ['/pid', String(c.pid), '/T', '/F'], { stdio: 'ignore' });
        else c.kill('SIGTERM');
      } catch {
        /* already gone */
      }
    }
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  for (const c of children) c.on('exit', (code) => code !== 0 && code !== null && stop());
}

const cmd = process.argv[2] ?? 'all';
if (!['all', 'load', 'start'].includes(cmd)) {
  console.error('usage: node scripts/demo.mjs [all|load|start]');
  process.exit(1);
}
if (cmd !== 'start') await load();
if (cmd !== 'load') start();
