const { spawnSync } = require('node:child_process');

const executable = process.platform === 'win32' ? 'python' : 'python3';
const result = spawnSync(executable, process.argv.slice(2), { stdio: 'inherit' });
if (result.error) {
  console.error('Unable to run Python. Install Python 3 and add it to PATH. ' + result.error.message);
}
process.exit(result.status === null ? 1 : result.status);
