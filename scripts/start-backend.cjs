const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const backendPath = path.join(root, 'backend', 'main.py')

const candidates = []

if (process.platform === 'win32') {
  candidates.push(
    { command: path.join(root, '.venv', 'Scripts', 'python.exe'), args: [backendPath], local: true },
    { command: 'python', args: [backendPath] },
    { command: 'py', args: ['-3', backendPath] },
  )
} else {
  candidates.push(
    { command: path.join(root, '.venv', 'bin', 'python'), args: [backendPath], local: true },
    { command: 'python3', args: [backendPath] },
    { command: 'python', args: [backendPath] },
  )
}

function start(index) {
  if (index >= candidates.length) {
    console.error('Could not find Python. Install Python 3 or create .venv, then retry.')
    process.exit(1)
  }

  const candidate = candidates[index]
  if (candidate.local && !fs.existsSync(candidate.command)) {
    start(index + 1)
    return
  }

  const child = spawn(candidate.command, candidate.args, {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    windowsHide: true,
  })

  child.once('error', (error) => {
    if (error.code === 'ENOENT') {
      start(index + 1)
      return
    }

    console.error(error)
    process.exit(1)
  })

  child.once('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal)
      return
    }

    process.exit(code ?? 0)
  })
}

start(0)
