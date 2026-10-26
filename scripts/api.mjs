import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const python=path.resolve(process.platform==='win32'?'.venv/Scripts/python.exe':'.venv/bin/python');
if (!existsSync(python)) throw new Error('Crie o ambiente Python e instale apps/api/requirements.lock.txt.');
const task=process.argv[2]??'serve';
const commands={
  serve:['-m','uvicorn','comandei.main:app','--host','127.0.0.1','--port','8000','--reload','--no-access-log'],
  worker:['-m','comandei.worker'],
  test:['-m','pytest','tests/api','-q'],
  check:['-m','comandei.core.db'],
  contract:['scripts/export-openapi.py'],
};
if (!commands[task]) throw new Error('Unknown API task');
const child=spawn(python,[...commands[task],...process.argv.slice(3)],{
  stdio:'inherit',env:{...process.env,PYTHONPATH:path.resolve('apps/api')},
});
child.on('exit',code=>process.exitCode=code??1);
