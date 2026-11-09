#!/usr/bin/env node
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { createServer as createHttpServer } from 'node:http'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const binary = process.env.SIYUAN_KERNEL
if (!binary) throw new Error('Set SIYUAN_KERNEL to an independently installed SiYuan 3.8.9 kernel')
const temp = await mkdtemp(join(tmpdir(), 'memories-review-'))
const children = new Set()
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function port() {
  const server = createServer()
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve))
  const value = server.address().port
  await new Promise((resolve) => server.close(resolve))
  return value
}
function run(command, args, options = {}) {
  const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] })
  children.add(child)
  let stdout = '',
    stderr = ''
  child.stdout.on('data', (data) => {
    stdout += data
  })
  child.stderr.on('data', (data) => {
    stderr += data
  })
  const done = new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code, signal) => {
      children.delete(child)
      resolve({ code, signal, stdout, stderr })
    })
  })
  return { child, done, output: () => stdout + stderr }
}
async function waitFor(test, description, timeout = 20000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    try {
      const result = await test()
      if (result) return result
    } catch {}
    await delay(100)
  }
  throw new Error(`Timed out waiting for ${description}`)
}
async function fixture(name, kernelPort, uiPort) {
  const dir = join(temp, name)
  await mkdir(join(dir, 'scripts/memories'), { recursive: true })
  await mkdir(join(dir, 'docs'), { recursive: true })
  for (const name of ['start.mjs', 'server.mjs', 'bootstrap.mjs']) {
    const source = await readFile(join(root, 'scripts/memories', name), 'utf8')
    await writeFile(
      join(dir, 'scripts/memories', name),
      source.replaceAll('16807', String(kernelPort)).replaceAll('16808', String(uiPort))
    )
  }
  for (const name of ['memories-agent-guide.md', 'setup.md'])
    await copyFile(join(root, 'docs', name), join(dir, 'docs', name))
  await symlink(join(root, 'node_modules'), join(dir, 'node_modules'), 'dir')
  return dir
}
async function startKernel(name) {
  const home = join(temp, name, 'home')
  const workspace = join(temp, name, 'workspace')
  const kernelPort = await port()
  await mkdir(home, { recursive: true })
  await mkdir(workspace, { recursive: true })
  const process = run(binary, ['--home-dir', home, '--workspace', workspace, 'serve', '--port', String(kernelPort)], {
    env: { ...globalThis.process.env, SIYUAN_ACCESS_AUTH_CODE: randomBytes(16).toString('hex') }
  })
  const base = `http://127.0.0.1:${kernelPort}`
  const token = await waitFor(async () => {
    const config = JSON.parse(await readFile(join(workspace, 'conf/conf.json'), 'utf8'))
    const response = await fetch(`${base}/api/system/version`, {
      method: 'POST',
      headers: { Authorization: `Token ${config.api.token}` },
      signal: AbortSignal.timeout(500)
    })
    return response.ok && (await response.json()).code === 0 && config.api.token
  }, 'SiYuan kernel')
  await waitFor(() => process.output().includes('kernel booted'), 'SiYuan boot')
  return { ...process, workspace, token, base, kernelPort }
}
async function connect(base, token) {
  const client = new Client({ name: 'memories-review-test', version: '1.0.0' })
  await client.connect(
    new StreamableHTTPClientTransport(new URL('/mcp', base), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } }
    })
  )
  return client
}
async function call(client, name, args) {
  for (let attempt = 0; ; attempt++) {
    const result = await client.callTool({ name, arguments: args })
    if (!result.isError) return result
    const message = JSON.stringify(result.content)
    if (attempt >= 20 || !message.includes('indexUnavailable')) throw new Error(message)
    await delay(250)
  }
}
const data = async (client, args) => (await call(client, 'database', args)).structuredContent.data
function createdId(result) {
  const text = result.content.find((item) => item.type === 'text')?.text || ''
  const id = text.match(/(?:id:\s*|created:\s*)(\d{14}-[a-z0-9]{7})/i)?.[1]
  assert.ok(id, text)
  return id
}
async function api(kernel, path, body) {
  const response = await fetch(kernel.base + path, {
    method: 'POST',
    headers: { Authorization: `Token ${kernel.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  const result = await response.json()
  assert.equal(result.code, 0, JSON.stringify(result))
  return result.data
}
async function bootstrap(kernel, script = join(root, 'scripts/memories/bootstrap.mjs')) {
  const result = await run(process.execPath, [script], {
    env: { ...process.env, SIYUAN_URL: kernel.base, SIYUAN_TOKEN: kernel.token, MEMORIES_MODULE_ROOT: root }
  }).done
  assert.equal(result.code, 0, result.stderr)
  return JSON.parse(result.stdout)
}
async function state(kernel, client, initialized) {
  const notebooks = (await api(kernel, '/api/notebook/lsNotebooks', {})).notebooks.filter(
    (x) => x.name === 'Cherry-Studio-Memories'
  )
  const docs = (await api(kernel, '/api/filetree/listDocsByPath', { notebook: initialized.notebook, path: '/' })).files
  const blocks = await api(kernel, '/api/query/sql', {
    stmt: `SELECT markdown FROM blocks WHERE root_id = '${initialized.memoriesDocument}' AND type = 'av'`
  })
  const ids = blocks.map((block) => block.markdown.match(/data-av-id="([^"]+)"/)?.[1])
  const matching = []
  for (const id of ids)
    if ((await api(kernel, '/api/av/getAttributeView', { id })).av.name === 'Memories') matching.push(id)
  assert.equal(notebooks.length, 1)
  assert.deepEqual(docs.map((x) => x.name).sort(), ['About', 'Agent Operating Guide', 'Memories', 'Skills'])
  assert.deepEqual([...new Set(matching)], [initialized.database])
  const schema = await data(client, { action: 'keys', id: initialized.database })
  for (const [name, expected] of [
    ['Type', ['Profile', 'Preference', 'Work', 'People', 'Notes']],
    ['Status', ['active', 'superseded', 'forgotten']]
  ]) {
    const options = schema.keys.find((x) => x.name === name).options.map((x) => x.name)
    assert.equal(new Set(options).size, options.length)
    for (const value of expected) assert.ok(options.includes(value), `${name}: ${value}`)
  }
  return schema
}

try {
  const kernelPort = await port(),
    uiPort = await port()
  const launcherFixture = await fixture('launcher', kernelPort, uiPort)
  const launcher = join(launcherFixture, 'scripts/memories/start.mjs')
  let result = await run(process.execPath, [launcher], {
    env: { ...process.env, MEMORIES_HOME: join(temp, 'missing'), SIYUAN_KERNEL: join(temp, 'missing-kernel') }
  }).done
  assert.equal(result.code, 1)
  assert.match(result.stderr, /not found or not executable/)
  console.log('#1 invalid SIYUAN_KERNEL: exit 1')

  const networkWorkspace = join(temp, 'network/workspace')
  await mkdir(join(networkWorkspace, 'conf'), { recursive: true })
  await writeFile(join(networkWorkspace, 'conf/conf.json'), JSON.stringify({ system: { networkServe: true } }))
  result = await run(process.execPath, [launcher], {
    env: {
      ...process.env,
      MEMORIES_HOME: join(temp, 'network'),
      SIYUAN_WORKSPACE: networkWorkspace,
      SIYUAN_KERNEL: binary
    }
  }).done
  assert.equal(result.code, 1)
  assert.match(result.stderr, /networkServe is enabled/)
  console.log('#4 networkServe=true: refused, exit 1')

  const failingKernel = join(temp, 'failing-kernel')
  await writeFile(failingKernel, '#!/bin/sh\nexit 17\n')
  await chmod(failingKernel, 0o755)
  result = await run(process.execPath, [launcher], {
    env: { ...process.env, MEMORIES_HOME: join(temp, 'failing-home'), SIYUAN_KERNEL: failingKernel }
  }).done
  assert.equal(result.code, 17)
  console.log('#1 kernel exit 17: launcher exit 17')

  const timeoutFixture = await fixture('timeout', await port(), await port())
  const timeoutLauncher = join(timeoutFixture, 'scripts/memories/start.mjs')
  await writeFile(timeoutLauncher, (await readFile(timeoutLauncher, 'utf8')).replace('attempt < 60', 'attempt < 2'))
  await writeFile(join(timeoutFixture, 'scripts/memories/server.mjs'), 'process.exit(0)\n')
  const idleKernel = join(timeoutFixture, 'idle-kernel')
  await writeFile(idleKernel, '#!/bin/sh\nexec /bin/sleep 120\n')
  await chmod(idleKernel, 0o755)
  result = await run(process.execPath, [timeoutLauncher], {
    env: { ...process.env, MEMORIES_HOME: join(temp, 'timeout-home'), SIYUAN_KERNEL: idleKernel }
  }).done
  assert.equal(result.code, 1)
  assert.match(result.stderr, /SiYuan did not become ready/)
  console.log('#1 startup timeout followed by clean UI exit and launcher SIGTERM: exit 1')

  await writeFile(join(launcherFixture, 'scripts/memories/bootstrap.mjs'), 'process.exit(0)\n')
  await writeFile(join(launcherFixture, 'scripts/memories/server.mjs'), 'setTimeout(() => process.exit(23), 4000)\n')
  const home = join(temp, 'launcher-home')
  const running = run(process.execPath, [launcher], {
    env: { ...process.env, MEMORIES_HOME: home, SIYUAN_KERNEL: binary }
  })
  const kernelPid = await waitFor(() => {
    const pids = execFileSync('pgrep', ['-P', String(running.child.pid)], { encoding: 'utf8' })
      .trim()
      .split(/\s+/)
    return pids.find((pid) =>
      execFileSync('ps', ['-p', pid, '-o', 'command='], { encoding: 'utf8' }).includes('SiYuan-Kernel')
    )
  }, 'launcher kernel')
  const code = (await waitFor(async () => readFile(join(home, 'access-code'), 'utf8'), 'access code')).trim()
  const command = execFileSync('ps', ['-p', kernelPid, '-o', 'command='], { encoding: 'utf8' })
  assert.ok(!command.includes(code) && !command.includes('--accessAuthCode'))
  result = await running.done
  assert.equal(result.code, 23, result.stderr)
  assert.match(result.stderr, /Space UI exited with code 23/)
  console.log('#1 UI exit 23 followed by launcher SIGTERM to kernel: exit 23')
  console.log('#3 real kernel ps command: no access code or --accessAuthCode')

  const freshKernelPort = await port(),
    freshUiPort = await port()
  const freshFixture = await fixture('fresh-launch', freshKernelPort, freshUiPort)
  const freshLauncher = join(freshFixture, 'scripts/memories/start.mjs')
  const autoVerify = process.platform === 'darwin' && process.arch === 'arm64'
  if (autoVerify) {
    await writeFile(
      freshLauncher,
      (await readFile(freshLauncher, 'utf8')).replace(
        '/Applications/SiYuan.app/Contents/Resources/kernel/SiYuan-Kernel',
        binary
      )
    )
  }
  const fresh = run(process.execPath, [freshLauncher], {
    env: {
      ...process.env,
      MEMORIES_HOME: join(temp, 'fresh-home'),
      SIYUAN_KERNEL: autoVerify ? '' : binary,
      MEMORIES_MODULE_ROOT: root,
      MEMORIES_LOCALES_DIR: join(root, 'src/main/i18n/locales')
    }
  })
  try {
    await waitFor(() => fresh.output().includes('CHERRY_SPACE_READY'), 'fresh launcher initialization', 30000)
    const status = await waitFor(async () => (await fetch(`http://127.0.0.1:${freshUiPort}/status`)).json(), 'fresh UI')
    assert.equal(status.ready, true)
  } catch (error) {
    throw new Error(`Fresh launcher failed: ${fresh.output()}`, { cause: error })
  }
  fresh.child.kill('SIGTERM')
  assert.equal((await fresh.done).code, 0)
  console.log('#1 fresh launcher: real kernel initialized, UI ready, clean shutdown exit 0')
  if (autoVerify) console.log('#5 trusted macOS arm64 kernel: SHA-256 accepted during automatic discovery')

  const badDir = join(temp, 'unverified-bin')
  await mkdir(badDir)
  await writeFile(join(badDir, 'SiYuan-Kernel'), `#!/bin/sh\ntouch '${temp}/unverified-ran'\n`)
  await chmod(join(badDir, 'SiYuan-Kernel'), 0o755)
  const launcherSource = await readFile(launcher, 'utf8')
  await writeFile(
    launcher,
    launcherSource.replace(
      '/Applications/SiYuan.app/Contents/Resources/kernel/SiYuan-Kernel',
      join(temp, 'absent-default')
    )
  )
  result = await run(process.execPath, [launcher], {
    env: {
      ...process.env,
      SIYUAN_KERNEL: '',
      MEMORIES_HOME: join(temp, 'unverified'),
      PATH: `${badDir}:${process.env.PATH}`
    }
  }).done
  assert.equal(result.code, 1, result.stderr)
  assert.match(result.stderr, /could not be verified/)
  await assert.rejects(readFile(join(temp, 'unverified-ran')))
  console.log('#5 unverified PATH kernel: refused, not executed, exit 1')

  const kernel = await startKernel('stress')
  const client = await connect(kernel.base, kernel.token)
  const decoyNotebook = createdId(await call(client, 'notebook', { action: 'create', name: 'Other Memories' }))
  const decoyDoc = createdId(
    await call(client, 'document', {
      action: 'create',
      notebook: decoyNotebook,
      parentID: '',
      title: 'Decoys',
      markdown: 'Test databases'
    })
  )
  const decoys = []
  for (let i = 0; i < 12; i++) {
    const created = await data(client, { action: 'create', parentID: decoyDoc, name: 'Memories' })
    decoys.push(created.avID)
  }
  const first = await bootstrap(kernel)
  const schema = await state(kernel, client, first)
  const keys = Object.fromEntries(schema.keys.map((x) => [x.name, x.id]))
  const row = (
    await data(client, { action: 'item_add', id: first.database, content: 'initial test row', detached: true })
  ).itemID
  await data(client, {
    action: 'item_update',
    id: first.database,
    itemID: row,
    keyID: keys.Memory,
    value: { type: 'block', block: { content: 'user edited test row' } }
  })
  await delay(1200)
  for (const id of decoys) await data(client, { action: 'item_add', id, content: 'refresh decoy', detached: true })
  const search = await data(client, { action: 'search', keyword: 'Memories' })
  assert.equal(search.results.length, 12)
  assert.ok(!search.results.some((x) => x.avID === first.database), 'target must be excluded by the search limit')
  const second = await bootstrap(kernel)
  assert.equal(second.database, first.database)
  await state(kernel, client, second)
  const rows = await data(client, { action: 'render', id: first.database, query: 'user edited test row' })
  assert.equal(rows.view.rows.length, 1)
  assert.equal(rows.view.rows[0].cells[0].value.block.content, 'user edited test row')
  console.log('#2 12 existing decoys; search returned 12 and omitted target')
  console.log('#2 two bootstraps: notebooks=1 databases=1 documents=4; Type/Status unique; edited row preserved')

  const guideFixture = await fixture('guide', kernel.kernelPort, await port())
  const oldGuide = first.guideDocument
  await api(kernel, '/api/block/appendBlock', { parentID: oldGuide, dataType: 'markdown', data: 'USER GUIDE EDIT' })
  const guideFile = join(guideFixture, 'docs/memories-agent-guide.md')
  await writeFile(guideFile, (await readFile(guideFile, 'utf8')) + '\nReview test guide version.\n')
  const updated = await bootstrap(kernel, join(guideFixture, 'scripts/memories/bootstrap.mjs'))
  assert.notEqual(updated.guideDocument, oldGuide)
  const oldContent = await api(kernel, '/api/block/getBlockKramdown', { id: oldGuide })
  const newContent = await api(kernel, '/api/block/getBlockKramdown', { id: updated.guideDocument })
  assert.match(oldContent.kramdown, /USER GUIDE EDIT/)
  assert.match(newContent.kramdown, /Review test guide version/)
  assert.equal(
    (await bootstrap(kernel, join(guideFixture, 'scripts/memories/bootstrap.mjs'))).guideDocument,
    updated.guideDocument
  )
  console.log('#9 changed guide: new document; user-edited old document preserved; repeat reused new version')

  const serverFixture = await fixture('server', kernel.kernelPort, await port())
  const serverSource = await readFile(join(serverFixture, 'scripts/memories/server.mjs'), 'utf8')
  const serverPort = Number(serverSource.match(/const port = (\d+)/)[1])
  const web = run(process.execPath, [join(serverFixture, 'scripts/memories/server.mjs')], {
    env: {
      ...process.env,
      SIYUAN_URL: kernel.base,
      SIYUAN_TOKEN: kernel.token,
      MEMORIES_MODULE_ROOT: root,
      MEMORIES_LOCALES_DIR: join(root, 'src/main/i18n/locales')
    }
  })
  const base = `http://127.0.0.1:${serverPort}`
  const page = await waitFor(async () => {
    const r = await fetch(base)
    return r.ok && r
  }, 'Space UI')
  assert.equal(page.headers.get('x-frame-options'), 'DENY')
  const nonce = (await page.text()).match(/initToken='([0-9a-f]+)'/)[1]
  const post = (token) =>
    fetch(`${base}/init`, { method: 'POST', headers: { Origin: base, ...(token ? { 'X-Memories-Init': token } : {}) } })
  assert.equal((await post()).status, 403)
  const accepted = await post(nonce)
  const acceptedBody = await accepted.json()
  assert.equal(accepted.status, 200, JSON.stringify(acceptedBody))
  const next = acceptedBody.initToken
  assert.equal((await post(nonce)).status, 403)
  assert.equal((await post(next)).status, 200)
  console.log('#6 X-Frame-Options=DENY; missing/replayed token=403; fresh tokens=200, 200')
  if (process.env.MEMORIES_BROWSER === '1') {
    const { chromium } = await import('@playwright/test')
    const browser = await chromium.launch({ headless: true, executablePath: process.env.MEMORIES_BROWSER_EXECUTABLE })
    const attacker = createHttpServer((_, response) => response.end(`<iframe src="${base}/"></iframe>`))
    try {
      await new Promise((resolve) => attacker.listen(0, '127.0.0.1', resolve))
      const page = await browser.newPage()
      assert.equal((await page.goto(base)).status(), 200)
      const initialized = page.waitForResponse((response) => response.url() === `${base}/init`)
      await page.locator('#init').click()
      assert.equal((await initialized).status(), 200)
      const messages = []
      page.on('console', (message) => messages.push(message.text()))
      await page.goto(`http://127.0.0.1:${attacker.address().port}/`)
      await waitFor(() => messages.some((message) => message.includes('X-Frame-Options')), 'iframe rejection')
      console.log('#6 Chrome: top-level initialization=200; cross-origin iframe blocked by X-Frame-Options')
    } finally {
      await browser.close()
      await new Promise((resolve) => attacker.close(resolve))
    }
  }
  web.child.kill('SIGTERM')
  await web.done
  await client.close()
  kernel.child.kill('SIGTERM')
  await kernel.done

  const smokeKernel = await startKernel('smoke')
  const smokeClient = await connect(smokeKernel.base, smokeKernel.token)
  const smokeDb = (await bootstrap(smokeKernel)).database
  const esmClient = import.meta.resolve('@modelcontextprotocol/sdk/client/index.js')
  const injector = join(temp, 'inject.mjs')
  await writeFile(
    injector,
    `import { appendFileSync } from 'node:fs';\nimport { Client } from ${JSON.stringify(esmClient)};\nconst connect=Client.prototype.connect, close=Client.prototype.close, call=Client.prototype.callTool;\nClient.prototype.connect=async function(...args){if(process.env.FAIL_MODE==='connect'&&this._clientInfo.name==='smoke-agent-b-new-session')throw Error('INJECT_B_CONNECT');return connect.apply(this,args)};\nClient.prototype.close=async function(...args){appendFileSync(process.env.CLOSE_LOG,this._clientInfo.name+'\\n');return close.apply(this,args)};\nClient.prototype.callTool=async function(args,...rest){if(process.env.FAIL_MODE==='cleanup'&&args.arguments?.action==='item_remove')throw Error('INJECT_CLEANUP_FAILURE');const result=await call.call(this,args,...rest);if(process.env.FAIL_MODE==='cleanup'&&this._clientInfo.name==='smoke-agent-b-new-session'&&args.arguments?.action==='render')result.structuredContent.data.view.rows=[];return result};\n`
  )
  for (const mode of ['connect', 'cleanup']) {
    const log = join(temp, `closed-${mode}`)
    const before = (await data(smokeClient, { action: 'render', id: smokeDb })).view.rowCount
    result = await run(process.execPath, [join(root, 'scripts/memories/smoke.mjs')], {
      env: {
        ...process.env,
        SIYUAN_URL: smokeKernel.base,
        SIYUAN_TOKEN: smokeKernel.token,
        NODE_OPTIONS: `--import=${injector}`,
        FAIL_MODE: mode,
        CLOSE_LOG: log
      }
    }).done
    assert.notEqual(result.code, 0)
    const closed = (await readFile(log, 'utf8')).trim().split('\n')
    assert.equal(closed.filter((name) => name === 'smoke-agent-a').length, 1)
    assert.equal(closed.filter((name) => name === 'smoke-agent-b-new-session').length, 1)
    if (mode === 'connect') {
      assert.match(result.stderr, /INJECT_B_CONNECT/)
      assert.equal(closed.filter((name) => name === 'smoke-cleanup').length, 1)
      assert.equal((await data(smokeClient, { action: 'render', id: smokeDb })).view.rowCount, before)
    } else {
      assert.match(result.stderr, /AssertionError/)
      assert.match(result.stderr, /INJECT_CLEANUP_FAILURE/)
      const remaining = await data(smokeClient, { action: 'render', id: smokeDb })
      const ids = remaining.view.rows.map((item) => item.id)
      await data(smokeClient, { action: 'item_remove', id: smokeDb, itemIDs: ids })
    }
  }
  console.log('#8 B connect failure: row removed; A/B/cleanup each closed once')
  console.log('#8 assertion plus cleanup failure: original AssertionError retained; test row manually removed')
  await smokeClient.close()
  smokeKernel.child.kill('SIGTERM')
  await smokeKernel.done
  console.log('Review verification passed')
} finally {
  await Promise.all(
    [...children].map(
      (child) =>
        new Promise((resolve) => {
          child.once('close', resolve)
          if (!child.kill('SIGTERM')) resolve()
        })
    )
  )
  await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
