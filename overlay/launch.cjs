// Starts the desktop app (npm run app). Editors such as VS Code set ELECTRON_RUN_AS_NODE for the
// processes they start, which would make Electron run as plain Node: it's cleared here.
const { spawn } = require('node:child_process');
const path = require('node:path');
const electron = require('electron'); // under Node: the path to the Electron binary

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [path.join(__dirname, 'main.cjs')], { env, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
