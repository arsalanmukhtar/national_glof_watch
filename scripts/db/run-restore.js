// ---------------------------------------------------------------------------
// Cross-platform launcher for the DB restore script. Mirrors
// run-backup.js — picks .ps1 on Windows, .sh elsewhere, and forwards
// any positional / flag args (e.g. the dump file path) untouched.
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const isWindows = process.platform === 'win32';
const script = join(here, isWindows ? 'restore.ps1' : 'restore.sh');

const cmd = isWindows ? 'powershell' : 'bash';
const args = isWindows
  ? ['-ExecutionPolicy', 'Bypass', '-File', script, ...process.argv.slice(2)]
  : [script, ...process.argv.slice(2)];

const child = spawn(cmd, args, { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
