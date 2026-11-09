#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = process.env.MEMORIES_HOME || join(homedir(), '.cherry-studio-memories')
const workspace = process.env.SIYUAN_WORKSPACE || join(root, 'workspace')
const binaryName = process.platform === 'win32' ? 'SiYuan-Kernel.exe' : 'SiYuan-Kernel'
const candidates = [
  process.env.SIYUAN_KERNEL,
  process.platform === 'darwin' ? '/Applications/SiYuan.app/Contents/Resources/kernel/SiYuan-Kernel' : null,
  ...(process.env.PATH || '').split(delimiter).flatMap((entry) => [join(entry, binaryName), join(entry, 'siyuan')])
].filter(Boolean)
let binary
for (const candidate of candidates) {
  try {
    await access(candidate, constants.X_OK)
    binary = candidate
    break
  } catch {
    /* Try the next installation. */
  }
}
if (!binary) {
  process.stderr.write(
    'SiYuan kernel not found. Install it from https://github.com/siyuan-note/siyuan/releases and set SIYUAN_KERNEL to the kernel path.\n'
  )
  process.exit(1)
}
try {
  await fetch('http://127.0.0.1:16807/api/system/version', { method: 'POST', signal: AbortSignal.timeout(1500) })
  throw new Error('Port 16807 is already in use. Stop that service before starting the Memories sidecar.')
} catch (error) {
  if (error.message.includes('already in use')) throw error
}
await mkdir(root, { recursive: true, mode: 0o700 })
await mkdir(workspace, { recursive: true, mode: 0o700 })
await mkdir(join(root, 'home'), { recursive: true, mode: 0o700 })
const codeFile = join(root, 'access-code')
let code
try {
  code = (await readFile(codeFile, 'utf8')).trim()
} catch (error) {
  if (error.code !== 'ENOENT') throw error
  code = randomBytes(24).toString('base64url')
  await writeFile(codeFile, code, { mode: 0o600, flag: 'wx' })
}
const kernel = spawn(
  binary,
  ['--home-dir', join(root, 'home'), '--workspace', workspace, 'serve', '--port', '16807', '--accessAuthCode', code],
  { stdio: ['ignore', 'inherit', 'inherit'] }
)
let web
let stopping = false
function stop() {
  if (stopping) return
  stopping = true
  web?.kill('SIGTERM')
  kernel.kill('SIGTERM')
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
kernel.on('exit', (status) => {
  stop()
  process.exitCode = status || 0
})
kernel.on('error', (error) => {
  process.stderr.write(`SiYuan could not start: ${error.message}\n`)
  stop()
  process.exitCode = 1
})
let ready = false
for (let attempt = 0; attempt < 60 && !stopping; attempt++) {
  try {
    const config = JSON.parse(await readFile(join(workspace, 'conf', 'conf.json'), 'utf8'))
    const response = await fetch('http://127.0.0.1:16807/api/system/version', {
      method: 'POST',
      headers: { Authorization: `Token ${config.api.token}`, 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(1000)
    })
    if (response.ok && (await response.json()).code === 0) {
      ready = true
      break
    }
  } catch {
    /* Kernel startup is asynchronous. */
  }
  await new Promise((resolve) => setTimeout(resolve, 500))
}
if (!ready) {
  process.stderr.write('SiYuan did not become ready.\n')
  stop()
  process.exitCode = 1
} else {
  process.stdout.write(
    `SiYuan access code is stored in ${codeFile}. Open http://127.0.0.1:16808/ and select Initialize.\n`
  )
  web = spawn(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), 'server.mjs')], {
    env: { ...process.env, SIYUAN_WORKSPACE: workspace },
    stdio: 'inherit'
  })
  web.on('exit', (status) => {
    if (!stopping) {
      stop()
      process.exitCode = status || 0
    }
  })
  web.on('error', (error) => {
    process.stderr.write(`Memories UI could not start: ${error.message}\n`)
    stop()
    process.exitCode = 1
  })
}
