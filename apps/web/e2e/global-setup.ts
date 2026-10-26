import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { API_PORT, DB_NAME, PASSWORD } from './helpers';

const here = path.dirname(fileURLToPath(import.meta.url));
const apiDir = path.resolve(here, '../../api');
const tsxCli = createRequire(import.meta.url).resolve('tsx/cli');

const base = process.env.DATABASE_URL ?? 'postgres://mmf:mmf_dev_only@localhost:5442/mmf';
const adminUrl = base.replace(/\/[^/]+$/, '/postgres');
const e2eUrl = base.replace(/\/[^/]+$/, `/${DB_NAME}`);

/** Fresh database -> migrated and seeded with one known password -> API on its own port. Returns the teardown. */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${DB_NAME}`);
  await admin.end();

  const env = { ...process.env, DATABASE_URL: e2eUrl, SEED_PASSWORD: PASSWORD, PORT: String(API_PORT), NODE_ENV: 'development' };
  execFileSync(process.execPath, [tsxCli, 'src/seed.ts'], { cwd: apiDir, env, stdio: 'pipe' });

  const api: ChildProcess = spawn(process.execPath, [tsxCli, 'src/server.ts'], { cwd: apiDir, env, stdio: 'pipe' });
  let log = '';
  api.stdout?.on('data', (d) => (log += d));
  api.stderr?.on('data', (d) => (log += d));

  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      const res = await fetch(`http://127.0.0.1:${API_PORT}/me`);
      if (res.status === 401) break;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline || api.exitCode !== null) throw new Error(`e2e API did not start:\n${log}`);
    await new Promise((r) => setTimeout(r, 300));
  }

  return async () => {
    if (api.pid === undefined) return;
    if (process.platform === 'win32') execFileSync('taskkill', ['/pid', String(api.pid), '/T', '/F'], { stdio: 'ignore' });
    else api.kill('SIGTERM');
  };
}
