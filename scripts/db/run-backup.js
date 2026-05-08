// ---------------------------------------------------------------------------
// Cross-platform launcher for the DB backup script. Picks the .ps1
// flavour on Windows and the .sh flavour everywhere else, then forwards
// any extra CLI args. Lets `npm run db:backup` work the same in dev
// (Windows) and on the VM (Linux) without each developer remembering
// which file extension to call.
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const isWindows = process.platform === 'win32';
const script = join(here, isWindows ? 'backup.ps1' : 'backup.sh');

const cmd = isWindows ? 'powershell' : 'bash';
const args = isWindows
  ? ['-ExecutionPolicy', 'Bypass', '-File', script, ...process.argv.slice(2)]
  : [script, ...process.argv.slice(2)];

const child = spawn(cmd, args, { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
