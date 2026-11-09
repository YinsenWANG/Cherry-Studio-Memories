#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { constants, createReadStream } from 'node:fs'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { constants as osConstants, homedir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = process.env.MEMORIES_HOME || join(homedir(), '.cherry-studio-memories')
const workspace = process.env.SIYUAN_WORKSPACE || join(root, 'workspace')
const dir = dirname(fileURLToPath(import.meta.url))
const backend = process.env.SIYUAN_URL || 'http://127.0.0.1:16807'
let kernel, web, initializer
let stopping = false
let failure

function fail(reason, code = 1) {
  if (failure) return
  failure = { reason, code }
  process.exitCode = code
  process.stderr.write(`${reason}\n`)
}

function childFailure(name, status, signal) {
  if (stopping || (status === 0 && !signal)) return
  fail(
    `${name} exited ${signal ? `on ${signal}` : `with code ${status}`}.`,
    status || 128 + (osConstants.signals[signal] || 1)
  )
}

function stop() {
  if (stopping) return
  stopping = true
  initializer?.kill('SIGTERM')
  web?.kill('SIGTERM')
  kernel?.kill('SIGTERM')
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)

function startWeb(reason = '') {
  web = spawn(process.execPath, [join(dir, 'server.mjs')], {
    env: { ...process.env, SIYUAN_WORKSPACE: workspace, SIYUAN_URL: backend, SIYUAN_START_ERROR: reason },
    stdio: 'inherit'
  })
  web.on('exit', (status, signal) => {
    if (!stopping) {
      childFailure('Space UI', status, signal)
      stop()
    }
  })
  web.on('error', (error) => {
    fail(`Space UI could not start: ${error.message}`)
    stop()
  })
}

async function initialize(token) {
  initializer = spawn(process.execPath, [join(dir, 'bootstrap.mjs')], {
    env: { ...process.env, SIYUAN_URL: backend, SIYUAN_TOKEN: token },
    stdio: ['ignore', 'ignore', 'inherit']
  })
  return new Promise((resolve) => {
    initializer.once('error', (error) => {
      if (!stopping) fail(`Space initialization could not start: ${error.message}`)
      resolve(false)
    })
    initializer.once('exit', (code, signal) => {
      childFailure('Space initialization', code, signal)
      resolve(code === 0)
    })
  })
}

async function main() {
  if (backend !== 'http://127.0.0.1:16807') {
    const initialized = process.env.SIYUAN_TOKEN && (await initialize(process.env.SIYUAN_TOKEN))
    if (!initialized && !stopping) fail('Space initialization failed.')
    startWeb(initialized ? '' : 'initialization_failed')
    if (initialized) process.stdout.write('CHERRY_SPACE_READY\n')
    return
  }

  const binaryName = process.platform === 'win32' ? 'SiYuan-Kernel.exe' : 'SiYuan-Kernel'
  const candidates = process.env.SIYUAN_KERNEL
    ? [process.env.SIYUAN_KERNEL]
    : [
        process.platform === 'darwin' ? '/Applications/SiYuan.app/Contents/Resources/kernel/SiYuan-Kernel' : null,
        ...(process.env.PATH || '')
          .split(delimiter)
          .flatMap((entry) => [join(entry, binaryName), join(entry, 'siyuan')])
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
    fail(
      'SiYuan kernel not found or not executable. Install it from https://github.com/siyuan-note/siyuan/releases and set SIYUAN_KERNEL to its path.'
    )
    if (!process.env.SIYUAN_KERNEL) startWeb('missing_kernel')
    return
  }

  if (!process.env.SIYUAN_KERNEL) {
    const expected =
      process.platform === 'darwin' && process.arch === 'arm64'
        ? 'a99c4483c90501d3289fd19831ae2a44c64731c5e1da1be925862b7541500fbd'
        : ''
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(binary)) hash.update(chunk)
    if (!expected || hash.digest('hex') !== expected) {
      fail(
        `SiYuan kernel could not be verified: ${binary}. Set SIYUAN_KERNEL explicitly after verifying the installation.`
      )
      startWeb('missing_kernel')
      return
    }
  }

  try {
    const config = JSON.parse(await readFile(join(workspace, 'conf', 'conf.json'), 'utf8'))
    if (config.system?.networkServe)
      throw new Error('SiYuan networkServe is enabled; disable network serving in the workspace before starting Space.')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }

  try {
    await fetch(`${backend}/api/system/version`, { method: 'POST', signal: AbortSignal.timeout(1500) })
    fail('Port 16807 is already in use; stop the other service before starting Space.')
    startWeb('port_in_use')
    return
  } catch {
    /* No server answered at the local kernel port. */
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
  kernel = spawn(binary, ['--home-dir', join(root, 'home'), '--workspace', workspace, 'serve', '--port', '16807'], {
    env: { ...process.env, SIYUAN_ACCESS_AUTH_CODE: code },
    stdio: ['ignore', 'inherit', 'inherit']
  })
  kernel.on('exit', (status, signal) => {
    childFailure('SiYuan', status, signal)
    stop()
  })
  kernel.on('error', (error) => {
    fail(`SiYuan could not start: ${error.message}`)
    stop()
  })
  let token
  for (let attempt = 0; attempt < 60 && !stopping; attempt++) {
    try {
      const config = JSON.parse(await readFile(join(workspace, 'conf', 'conf.json'), 'utf8'))
      const response = await fetch(`${backend}/api/system/version`, {
        method: 'POST',
        headers: { Authorization: `Token ${config.api.token}`, 'Content-Type': 'application/json' },
        body: '{}',
        signal: AbortSignal.timeout(1000)
      })
      if (response.ok && (await response.json()).code === 0) {
        token = config.api.token
        break
      }
    } catch {
      /* Kernel startup is asynchronous. */
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  if (!token || stopping) {
    if (!stopping) {
      fail('SiYuan did not become ready.')
      startWeb('startup_failed')
    }
    return
  }
  const initialized = await initialize(token)
  if (stopping) return
  startWeb(initialized ? '' : 'initialization_failed')
  if (initialized) process.stdout.write('CHERRY_SPACE_READY\n')
  process.stdout.write(`SiYuan access code is stored in ${codeFile}.\n`)
}

main().catch((error) => {
  fail(`Space could not start: ${error.message}`)
  stop()
})
