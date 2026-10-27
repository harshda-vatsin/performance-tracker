import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { DEMO_API_PORT, DEMO_DB } from './helpers';

const here = path.dirname(fileURLToPath(import.meta.url));
const apiDir = path.resolve(here, '../../api');
const tsxCli = createRequire(import.meta.url).resolve('tsx/cli');

const base = process.env.DATABASE_URL ?? 'postgres://mmf:mmf_dev_only@localhost:5442/mmf';
const adminUrl = base.replace(/\/[^/]+$/, '/postgres');
const demoUrl = base.replace(/\/[^/]+$/, `/${DEMO_DB}`);

/** Fresh mmf_demo -> migrated and loaded with the demo data -> API on its own port. Returns the teardown. */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${DEMO_DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${DEMO_DB}`);
  await admin.end();

  const env = { ...process.env, DATABASE_URL: demoUrl, PORT: String(DEMO_API_PORT), NODE_ENV: 'development' };
  execFileSync(process.execPath, [tsxCli, 'src/seed-demo.ts'], { cwd: apiDir, env, stdio: 'pipe' });

  const api: ChildProcess = spawn(process.execPath, [tsxCli, 'src/server.ts'], { cwd: apiDir, env, stdio: 'pipe' });
  let log = '';
  api.stdout?.on('data', (d) => (log += d));
  api.stderr?.on('data', (d) => (log += d));

  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      if ((await fetch(`http://127.0.0.1:${DEMO_API_PORT}/me`)).status === 401) break;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline || api.exitCode !== null) throw new Error(`demo API did not start:\n${log}`);
    await new Promise((r) => setTimeout(r, 300));
  }

  return async () => {
    if (api.pid === undefined) return;
    if (process.platform === 'win32') execFileSync('taskkill', ['/pid', String(api.pid), '/T', '/F'], { stdio: 'ignore' });
    else api.kill('SIGTERM');
  };
}
