# Verification report — 2026-11-09

All examples used temporary directories under `/tmp`, not the user's existing Cherry or SiYuan workspace. The tested upstream Cherry commit was `578dcc183632de98b9b4165155112c4f9298663c`; macOS arm64, SiYuan 3.8.9, Node 24.22.0, pnpm 12.6.0. The initial attempt with Node 22 failed when Corepack's pnpm download terminated; upstream currently requires Node >=24.12 and pins pnpm 12.6.0. Retrying with installed Node 24 succeeded.

## Install and build

```sh
PATH=/opt/homebrew/opt/node@24/bin:$PATH CI=1 pnpm install --frozen-lockfile
# Done in 51.2s using pnpm v12.6.0
PATH=/opt/homebrew/opt/node@24/bin:$PATH CI=1 /usr/bin/time -p pnpm build
# real 37.54
# user 110.68
# sys 16.59
# exit 0; out/ is 157 MiB (build output, not an installer)
```

The modified Cherry source passed the full upstream `pnpm build`, including type checks, renderer/main/preload and utility-process builds. No Electron installer was built, so an installer-size delta is **not measured**. The external SiYuan 3.8.9 macOS arm64 DMG downloaded as 279,981,928 bytes, with SHA-256 matching the upstream checksum; nothing from that DMG is added to the repository or installer.

```sh
pnpm test:shared src/shared/data/presets/__tests__/mcpServers.test.ts src/shared/data/presets/__tests__/builtinMiniAppCatalog.test.ts
# 2 test files passed, 6 tests passed
pnpm test:main src/main/data/db/seeding/seeders/__tests__/miniAppSeeder.test.ts
# 1 test file passed, 10 tests passed
pnpm exec oxfmt --check scripts/memories/*.mjs src/renderer/i18n/label.ts src/shared/data/presets/mcpServers.ts src/shared/data/presets/miniApps.ts src/shared/utils/mcp.ts
# All matched files use the correct format.
pnpm exec oxlint --deny-warnings scripts/memories/*.mjs src/renderer/i18n/label.ts src/shared/data/presets/mcpServers.ts src/shared/data/presets/miniApps.ts src/shared/utils/mcp.ts
# exit 0
```

## Fresh startup and idempotent setup

```sh
PATH=/opt/homebrew/opt/node@24/bin:$PATH \\
  MEMORIES_HOME=/tmp/cherry-memories-fresh2 \\
  SIYUAN_KERNEL=/tmp/cherry-memories-siyuan-mount/SiYuan.app/Contents/Resources/kernel/SiYuan-Kernel \\
  node scripts/memories/start.mjs
# kernel booted, HTTP server 127.0.0.1:16807
# Memories UI: http://127.0.0.1:16808/
curl -fsS http://127.0.0.1:16808/status
# {"ready":true}
curl -fsS -X POST -H 'Origin: http://127.0.0.1:16808' http://127.0.0.1:16808/init
# {"ok":true}
# Same POST a second time: {"ok":true}
```

The first implementation exposed a genuine fresh-workspace race: SiYuan returned `indexUnavailable` immediately after creating the notebook. The initializer now retries only that explicit pre-creation error; a new clean workspace succeeded on its first and second button requests. Native MCP inspection found exactly one `Cherry-Studio-Memories` notebook and one matching `Memories` attribute-view database; its Type and Status columns contain the expected options. The workspace contains `Agent Operating Guide`, `About` and `Skills` documents. After the Skill initializer was added, two more successful runs left a native `data/storage/ai/agent/skills/cherry-studio-memories/SKILL.md` in the test workspace.

## Two MCP clients, correction, GUI edit and removal

```sh
PATH=/opt/homebrew/opt/node@24/bin:$PATH \\
  SIYUAN_WORKSPACE=/tmp/cherry-memories-fresh2/workspace node scripts/memories/smoke.mjs
# A wrote: 品牌主色不用紫色 70bd99c1
# B recalled A and its source
# B corrected: 品牌主色改为蓝色，不用紫色 70bd99c1
# B removed the row; matching rows: 0
```

This is a reproducible **two independent MCP client session** test, not two LLM conversations. A closes before B connects; B searches the same database, verifies the source field, edits the same row, removes it, and checks the database search no longer returns that unique marker. A separate earlier GUI test created `品牌主色不用紫色`, retrieved and corrected it via MCP, signed in to the SiYuan browser GUI, opened the native Memories table, double-clicked the same row and changed it to `品牌主色以蓝色为主，不用紫色`; a fresh MCP session read that GUI edit and removed the row. Database removal is **not** proof that SiYuan history, backups or remote copies have been erased.

## Cherry and setup UI

A built Electron app was launched with `CS_DEV_PROFILE_ROOT=/tmp/cherry-memories-app-profile`; no model/provider was connected. Via its UI: Launchpad → 小程序 → Memories opened a Cherry webview at `http://127.0.0.1:16808/` and displayed a connected backend and the setup prompt. In the isolated Cherry profile, the MCP catalog preset was manually added, supplied with the temporary workspace token, and enabled: its settings showed `已连接`, server version `3.8.9`, and `工具 (31)`. A trusted mouse click on the copy button in the Electron webview wrote the exact `http://127.0.0.1:16808/setup` prompt to the system clipboard, confirmed with `pbpaste`; the initial `navigator.clipboard` implementation failed in Electron and was fixed with a user-gesture copy fallback. In a separate Chrome/Playwright session, the initialize button completed and the local setup URL returned HTTP 200. An invalid cross-origin POST to `/init` returned HTTP 403. The SiYuan GUI test above used a separate temporary workspace and test access code.

## Not yet verified / missing

- The MCP preset is **not auto-installed, auto-configured or automatically bound** to Cherry's built-in agent. The user must add it, enter the SiYuan token, enable it and bind it in the agent editor. The configured preset connected and listed 31 tools in Cherry; binding it to an agent and invoking the tools through a model were not exercised.
- No real model-backed Agent A/B ran. We did not verify that a model follows the guide, decides what to save, uses a recalled preference in an answer, resolves a conflict, or carries out a complete forget request across all copies.
- The native Skills index and example SKILL.md exist, but Notion's per-surface enabled list, full skill package migration, conflict prevention and automatic reimport exclusions are not reproduced.
- The sidecar is a source-checkout process requiring Node and SiYuan. Binary detection and a download link are provided; there is no bundled installer or automatic download. Linux/Windows startup and GUI were not tested. Remote access requires a separate secure deployment.
- Actual full Notion Memories schema/source-agent property remains unverified without an authorized Notion workspace. Installer size, backup/history purge, concurrent writers, and hardened multi-user isolation have not been tested.

The commits are GPG-signed and verify locally. GitHub reported the pushed commit signature as `verified: false`, reason `no_user`; the signing key email is not currently associated with a verified GitHub account. GitHub account/key verification is outside this checkout.

## 审查修复（2026-11-09）

本次修复的起点是 `5b3b1e93888fe352b1d7171981e8b9c8c8c29d07`；Grok 原始审查针对 `519972a00`，实现提交为 `d9ff4353d`。动手前实际输出：

```text
$ git status --short --branch
## main...origin/main
$ git log --oneline -3
5b3b1e938 feat(space): enable shared memory workspaces by default
519972a00 docs(memories): clarify launch and signature status
846bfde3c docs(memories): add setup and verification results
```

### 逐条复核与改动

九条在起点均未被完整覆盖。二期改变了第 1 条的超时流程：超时后保留错误页面，而非立即停止内核，但 UI 先失败后仍会被内核退出覆盖。二期还合并了现有数据库选项；这里保留这部分实现，没有重写。

| 意见 | 起点复核与本次修复 | 文件与变更行数（新增/删除） |
| --- | --- | --- |
| 1 | 启动器仍覆盖退出码；记录首次失败及退出码，忽略主动停止的子进程退出。 | `scripts/memories/start.mjs`，共 +80/-28，亦对应 3–5。 |
| 2 | 仍用截断搜索；刷新事务后分页读取目标文档的数据库块并按名称检查。 | `scripts/memories/bootstrap.mjs`，共 +45/-8，亦对应 9。 |
| 3 | 访问码仍在参数中；改为 `SIYUAN_ACCESS_AUTH_CODE`。 | `scripts/memories/start.mjs`。 |
| 4 | 启动前没有检查 `networkServe`；启用时拒绝启动。 | `scripts/memories/start.mjs`。 |
| 5 | 自动发现路径没有校验；自动发现的内核按已验证发行包的 SHA-256 校验，显式 `SIYUAN_KERNEL` 由调用方验证。 | `scripts/memories/start.mjs`；`README.md` +1/-1。 |
| 6 | 没有防嵌入和初始化凭证；增加 `X-Frame-Options: DENY` 和一次性凭证。 | `scripts/memories/server.mjs` +21/-8。 |
| 7 | 预设仍指向 `no`；新增说明并翻译所有现有语言。 | `src/renderer/i18n/label.ts` +1/-1；`src/renderer/i18n/locales/*.json` 15 个文件各 +1。 |
| 8 | B 连接失败时可能漏删和重复关闭；清理时重连并保留原错误。 | `scripts/memories/smoke.mjs` +36/-11。 |
| 9 | 同名指南仍直接返回；比较现有内容，变更时新建版本，保留用户编辑。 | `scripts/memories/bootstrap.mjs`；`docs/architecture.md` +2/-2；`docs/setup.md` +1/-1。 |

验证脚本 `scripts/memories/tests/verify-review.mjs` 新增 472 行；配套决策记录 `.agents/notes/implemented/bug-fix/2026-11-09-siyuan-space-safety.md` 和 `.zh.md` 各 27 行，`.i18n.yaml` 5 行；本报告 +157/-0。可用以下命令重新核对起点，输出为实际结果：

```text
$ git show 5b3b1e938:scripts/memories/start.mjs | rg -n 'process.exitCode|accessAuthCode|candidates|networkServe'
35:      process.exitCode = status || 0
41:    process.exitCode = 1
65:  const candidates = [
71:  for (const candidate of candidates) {
107:    ['--home-dir', join(root, 'home'), '--workspace', workspace, 'serve', '--port', '16807', '--accessAuthCode', code],
112:    process.exitCode = status || 0
117:    process.exitCode = 1
152:  process.exitCode = 1
$ git show 5b3b1e938:scripts/memories/bootstrap.mjs | rg -n "if \\(existing\\)|action: 'search'|const missing"
77:    if (existing) return existing.id
104:  const search = await call('database', { action: 'search', keyword: 'Memories' })
143:    const missing = values?.filter((name) => !options.some((option) => option.name === name)) || []
$ git show 5b3b1e938:scripts/memories/server.mjs | rg -n 'X-Frame|req.url.*init'
101:  if (req.method === 'POST' && req.url === '/init') {
$ git show 5b3b1e938:src/renderer/i18n/label.ts | rg -n 'sharedMemories'
348:  [BuiltinMcpServerNames.sharedMemories]: 'settings.mcp.builtinServersDescriptions.no',
$ git show 5b3b1e938:scripts/memories/smoke.mjs | rg -n 'await a.close|if [(]row && b[)]'
54:  await a.close()
80:  if (row && b) await db(b, { action: 'item_remove', id, itemIDs: [row] })
82:  else await a.close()
$ if git grep -n 'networkServe' 5b3b1e938 -- scripts/memories/start.mjs; then :; else echo 'networkServe check: absent'; fi
networkServe check: absent
$ if git grep -n -e 'X-Frame-Options' -e 'frame-ancestors' -e 'initToken' 5b3b1e938 -- scripts/memories/server.mjs; then :; else echo 'frame protection and init token: absent'; fi
frame protection and init token: absent
$ if git grep -n -e 'sha256' -e 'createHash' 5b3b1e938 -- scripts/memories/start.mjs; then :; else echo 'kernel hash verification: absent'; fi
kernel hash verification: absent
```

### 真实内核与浏览器回归

使用单独挂载的 SiYuan 3.8.9 macOS arm64 内核、Node 24.18.0 和临时工作区。原有的 16807/16808 被其他进程占用；测试没有停止或改动它们，而是在临时脚本副本中替换端口。超时测试在副本中将等待次数从 60 缩到 2；UI 失败测试让副本中的 UI 以 23 退出，使用真实 SiYuan 子进程；自动校验测试将副本的默认 macOS 路径指向已挂载的发行包。其他故障注入及临时文件由脚本创建、清理。Chrome 检查可省略 `MEMORIES_BROWSER`；执行下面的命令需要本机 Chrome 和单独安装的内核：

```sh
SIYUAN_KERNEL=/tmp/cherry-memories-siyuan-mount/SiYuan.app/Contents/Resources/kernel/SiYuan-Kernel \
MEMORIES_BROWSER=1 \
MEMORIES_BROWSER_EXECUTABLE='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
PATH="/Users/cherryai001/.nvm/versions/node/v24.18.0/bin:$PATH" \
node scripts/memories/tests/verify-review.mjs
```

```text
#1 invalid SIYUAN_KERNEL: exit 1
#4 networkServe=true: refused, exit 1
#1 kernel exit 17: launcher exit 17
#1 startup timeout followed by clean UI exit and launcher SIGTERM: exit 1
#1 UI exit 23 followed by launcher SIGTERM to kernel: exit 23
#3 real kernel ps command: no access code or --accessAuthCode
#1 fresh launcher: real kernel initialized, UI ready, clean shutdown exit 0
#5 trusted macOS arm64 kernel: SHA-256 accepted during automatic discovery
#5 unverified PATH kernel: refused, not executed, exit 1
#2 12 existing decoys; search returned 12 and omitted target
#2 two bootstraps: notebooks=1 databases=1 documents=4; Type/Status unique; edited row preserved
#9 changed guide: new document; user-edited old document preserved; repeat reused new version
#6 X-Frame-Options=DENY; missing/replayed token=403; fresh tokens=200, 200
#6 Chrome: top-level initialization=200; cross-origin iframe blocked by X-Frame-Options
#8 B connect failure: row removed; A/B/cleanup each closed once
#8 assertion plus cleanup failure: original AssertionError retained; test row manually removed
Review verification passed
```

压力测试先在独立笔记本创建 12 个名字为 `Memories` 的干扰数据库，再首次 bootstrap；修改目标记忆行、更新干扰库使搜索实际漏掉目标后立即再次 bootstrap。两次分别检查笔记本列表、目标文档中的数据库数量、四篇文档及选项；第二次还检查用户修改过的行。原生 SQL 索引可能滞后，因此查询前和创建后调用 [SiYuan 的事务刷新接口](https://github.com/siyuan-note/siyuan/blob/v3.8.9/docs/API.md#flush-transaction)。

第 8 条还用正常的两个真实 MCP 会话单独验证：

```text
$ SIYUAN_WORKSPACE=/tmp/cherry-siyuan-review.Xoi1tv/workspace SIYUAN_URL=http://127.0.0.1:17671 PATH="/Users/cherryai001/.nvm/versions/node/v24.18.0/bin:$PATH" node scripts/memories/smoke.mjs
A wrote: 品牌主色不用紫色 80af6522
B recalled A and its source
B corrected: 品牌主色改为蓝色，不用紫色 80af6522
B removed the row; matching rows: 0
```

自动校验使用的内核来自已挂载的发行 DMG。两项实际哈希：

```text
$ shasum -a 256 /tmp/cherry-memories-downloads/siyuan-3.8.9-mac-arm64.dmg /tmp/cherry-memories-siyuan-mount/SiYuan.app/Contents/Resources/kernel/SiYuan-Kernel
633e7c37bfa310305a9d30eec2fde40dddf23da20fd9e43a7dd273428b834513  /tmp/cherry-memories-downloads/siyuan-3.8.9-mac-arm64.dmg
a99c4483c90501d3289fd19831ae2a44c64731c5e1da1be925862b7541500fbd  /tmp/cherry-memories-siyuan-mount/SiYuan.app/Contents/Resources/kernel/SiYuan-Kernel
```

### 安装、构建与检查

```text
$ env PATH="/Users/cherryai001/.nvm/versions/node/v24.18.0/bin:$PATH" /usr/bin/time -p sh -c 'pnpm install && pnpm build' > /tmp/cherry-siyuan-review.Xoi1tv/final-build.log 2>&1
$ head -6 /tmp/cherry-siyuan-review.Xoi1tv/final-build.log
Scope: all 17 workspace projects
Already up to date
Done in 6ms using pnpm v12.6.0
$ pnpm run typecheck && dotenv -v CHERRY_EDITION=global -- electron-vite build && pnpm run build:utility-process
$ pnpm check --all --group types
$ node scripts/validation/run.mjs --all --group types
$ tail -5 /tmp/cherry-siyuan-review.Xoi1tv/final-build.log

✓ built in 47ms
real 33.97
user 89.73
sys 10.86
# exit 0
$ pnpm test:shared src/shared/data/presets/__tests__/mcpServers.test.ts
Test Files  1 passed (1)
     Tests  5 passed (5)
$ pnpm i18n:check
i18n 检查已通过（已校验 102221 条翻译）
$ node -e 'const fs=require("fs"),assert=require("assert"); const k="settings.mcp.builtinServersDescriptions.shared_memories"; for(const l of ["en-us","zh-cn"]) {const s=JSON.parse(fs.readFileSync(`src/renderer/i18n/locales/${l}.json`))[k]; assert(s); console.log(`${l}: ${s}`)}'
en-us: Connects to the local SiYuan workspace by default and requires workspace administrator access. Data stays on this device by default.
zh-cn: 默认连接本机 SiYuan 工作区，需要工作区管理员权限。默认情况下数据保留在本机。
$ pnpm exec oxlint --deny-warnings scripts/memories/start.mjs scripts/memories/bootstrap.mjs scripts/memories/server.mjs scripts/memories/smoke.mjs scripts/memories/tests/verify-review.mjs src/renderer/i18n/label.ts
# exit 0, no output
$ pnpm exec eslint scripts/memories/start.mjs scripts/memories/bootstrap.mjs scripts/memories/server.mjs scripts/memories/smoke.mjs scripts/memories/tests/verify-review.mjs src/renderer/i18n/label.ts
# exit 0, no output
$ pnpm exec oxfmt --check scripts/memories/start.mjs scripts/memories/bootstrap.mjs scripts/memories/server.mjs scripts/memories/smoke.mjs scripts/memories/tests/verify-review.mjs src/renderer/i18n/label.ts
All matched files use the correct format.
$ pnpm docs:check
All links are valid.
Docs structure OK.
Doc frontmatter OK.
Agent Note format OK.
Bilingual pairing OK (188 pairs).
Documentation terminology OK.
Docs index OK.
```

局限：只在 macOS arm64、SiYuan 3.8.9 和独立工作区上运行；没有验证并发 bootstrap、Windows/Linux、真实模型或安装包。自动校验目前只内置该平台和版本的哈希；其他内核须由调用方先验证并显式设置路径。一次性凭证和防嵌入针对浏览器请求；能主动读取本机页面的进程仍能取得凭证。
