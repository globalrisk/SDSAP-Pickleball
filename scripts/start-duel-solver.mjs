import { spawn } from 'node:child_process'
const child = spawn(process.env.DUEL_CPSAT_PYTHON || 'python', ['scripts/test-support/duel-solver-server.py', '--port', '8001'], { stdio: 'inherit', windowsHide: true })
child.on('error', error => { console.error(error.message); process.exitCode = 1 })
child.on('exit', code => { process.exitCode = code ?? 0 })
process.on('SIGINT', () => child.kill())
process.on('SIGTERM', () => child.kill())
