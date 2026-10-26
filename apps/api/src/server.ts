import { buildApp } from './app.js';
import { config } from './config.js';
import { createPool } from './db.js';
import { migrate } from './migrate.js';

const pool = createPool();
await migrate(pool);
const app = buildApp(pool);
const port = Number(process.env.PORT ?? 4000);
await app.listen({ port, host: '127.0.0.1' });
console.log(`API listening on http://127.0.0.1:${port} (mfaBypass=${config.mfaBypassUntilMfaSlice})`);
