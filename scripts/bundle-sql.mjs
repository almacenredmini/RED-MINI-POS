// Une las migraciones en un solo archivo para pegar en el editor SQL de Supabase.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = 'supabase/migrations';
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
const body = files.map((f) => `-- ===== ${f} =====\n${readFileSync(join(dir, f), 'utf8')}`).join('\n');
writeFileSync('supabase/setup.sql', `-- Generado con "npm run sql:bundle". No editar a mano.\n\n${body}`);
console.log(`supabase/setup.sql: ${files.length} migraciones`);
