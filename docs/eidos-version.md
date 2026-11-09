# Eidos 版原型

## 选择与数据边界

本版采用 **路线 B：Eidos CLI sidecar**。Cherry 启动同一个 Eidos 3.3.2 `serve` 进程，网页表格和四个 MCP 工具都通过该进程的 HTTP Runtime 读写同一份 `space.eidos`；初始化新文件时才调用 CLI 创建表。Eidos 官方要求 Serve 是文件的唯一物理写者，运行时不要用其他 CLI 或 SQLite 进程写同一个文件。每次变更使用 Eidos revision，冲突会返回错误，需要重新读取后重试。

按要求先评估了路线 A：Eidos File 核心确实可以嵌入，但其表格 UI 还需要 glide-data-grid、Runtime/SQLite 适配及 Cherry 的跨进程桥接；Markdown 编辑器是 private、pre-release 包，页面树和文件保存仍由宿主负责。独立评估中，表格 UI 的 npm 依赖树为 150.27 MiB（开发依赖树，不是安装增量），表格 PoC 估计 3–5 人日。为先交付可试的版本，本次没有完成 A 的集成。路线 C 的零新增 npm 依赖自建表格作为兜底；B 的原生网格、筛选和 MCP 已跑通，因此没有走 C。两种未选路线的最终 Cherry 安装增量均未实测。

Eidos CLI 不管理普通文档：本版页面是 `pages/` 下的 Markdown 文件，界面使用文本编辑器和显式保存；表格是单独的 SQLite 文件。没有把页面伪装成 Eidos 数据库里的富文本文档。初始化会创建 Agent Operating Guide 和 Skills 索引，已有文件不会被覆盖。不会同步或扫描 Cherry agent 的私有记忆。

Memories 表有 `Title`、`Body`、`Type`（Profile / Preference / Work / People / Notes）、`SourceAgent`、`Status`（active / superseded / forgotten）、`SourceURL` 和 `ConfirmedAt`。MCP 提供 `memory_search`、`memory_create`、`memory_update`、`memory_forget`；检索支持 Type / Status 并返回来源。遗忘将当前行内容、来源清空，保留不含原文的 forgotten 标记；不保证 SQLite 空闲页、备份或其他系统的副本被擦除。

## 运行和连接

在 macOS arm64 的本仓库中：

```sh
pnpm install
pnpm dev
```

需要 Node >=24.12，pnpm 版本由仓库固定。Cherry 中打开「启动台 → 小程序 → Memories」；左侧新建页面，填写 Markdown 后点击保存，或打开 Memories 表格加行、编辑及按 Type 筛选。空间自动初始化，不需要安装 SiYuan。默认 Cherry 配置目录使用 `~/.cherrystudio-eidos`，开发数据使用独立的 Eidos 后缀；打包应用使用独立的应用名和标识，macOS 上不接管原 Cherry 的 URL 处理器。数据位于 `<Cherry userData>/Data/SharedMemories`，包括 `space.eidos` 和 `pages/`。

Cherry 运行时，外部 MCP 客户端连接 `http://127.0.0.1:16818/mcp`。在 Cherry 内需在 MCP 目录手动添加并启用 `@cherry/shared-memories`，再绑定到目标 agent；系统提示已加入共享记忆规则，但提示不是行为强制，也不会自动绑定工具。空间内的复制按钮提供：

```text
使用这个指南帮我设置 Cherry-Studio-Memories 作为我的上下文系统：http://127.0.0.1:16818/setup
```

该 URL 只适用于同机 agent。`16818` 是空间和 MCP，`16819` 是 Eidos 表格；两者只绑定 loopback，但没有用户级认证，本机其他进程可以读写。同一时间只运行一个 Eidos 版实例：端口占用时第二个实例的入口可能显示第一个实例的空间，解决占用后再启动。不要将端口暴露到网络。

## 验证与证据

在隔离目录 `/tmp/cherry-eidos-electron` 中启动 Cherry，通过实际 Electron 窗口打开上述入口；[截图](eidos-electron.png)显示空间、Operating Guide 和真实 Eidos 表格。浏览器自动化在独立临时工作区实际新建页面、保存并刷新后读取；在网格添加并编辑一行后通过 MCP 找到，且实际应用了 `Type = Preference` 筛选。Electron 内点击复制按钮得到上面的完整提示。

Cherry 运行时执行：

```sh
node scripts/memories-eidos/smoke.mjs
```

[终端实测输出](eidos-demo.txt)记录了对打包目录中的应用进行的测试：会话 A 写入、关闭 A、会话 B 检索到来源、修改同一行并遗忘。**这是两个独立 MCP 客户端会话，非模型驱动**；没有配置真实模型，也没有声称模型遵循了规则。测试留下一个不含原文的 forgotten 标记。跨来源网页请求到空间 API 实测返回 403。

已运行 `pnpm install --frozen-lockfile`、`pnpm build`，以及针对 prompt、路径隔离、协议注册和预设的定向测试；具体结果见交付说明。`pnpm check --plan` 因新增二进制和演示输出选择了保守全量范围，未据此运行全量测试。

## 体积

同一机器、同一构建命令下，改动前 `out/` 为 161,260 KiB，改动后为 161,296 KiB，增加 36 KiB；这只是构建输出，**不包含**单独打包的 Eidos 可执行文件。官方 macOS arm64 CLI 压缩包实测 6,119,774 B，解包二进制 14,166,512 B；SHA-256 与上游发布校验一致。没有以独立 Eidos Lite 桌面应用作为依赖。安装包结果见下方的实际打包记录，不能把上述数字当成安装包差值。

`dist/Cherry-Memories-Eidos-2.1.10-mac-arm64.zip` 为 **302,998,827 B（288.96 MiB）**，SHA-256 为 `0c6086932bdfef1092190d37cb7666cd6461f68ec66434030e7eff5f2d2c325d`。`unzip -tq` 通过，打包目录中的 `.app` 已启动并通过上述 MCP 冒烟；没有另行测试从 ZIP 解压后的启动。打包时没有开发者签名和公证，macOS 可能要求用户在系统设置中允许打开。未构建同配置的 SiYuan 安装包，因此没有安装包增量数字。

## 已知限制

- 页面是纯文本 Markdown 编辑，尚无富文本、嵌套页面树、页面删除、附件或跨页面搜索；页面的并发保存没有冲突检测。
- 搜索是字面子串匹配，不是语义搜索；最多扫描 10,000 行。Eidos 不向该宿主提供实时变更事件，其他客户端写入后表格可能需要刷新。
- Skills 页面只是索引，不是 Notion 的启用列表或技能包管理；没有定时采集、后台同步或跨设备同步。
- 本版只随仓库提供 macOS arm64 Eidos 二进制。没有完成其他平台、数据迁移、备份恢复、崩溃恢复、长期并发或完整第三方许可证清单验证；sidecar 异常退出后不会自动重启。备份前先退出应用，并同时保存 `SharedMemories` 目录里的数据库和页面。
- 这是本机单用户原型；任意本机进程可以访问两个端口。没有逐 agent 权限隔离，也没有经过安全审计。

## 与 SiYuan 版的差异

SiYuan 版另行安装 279,981,928 B 的 macOS arm64 DMG，使用 SiYuan 内核、原生文档和属性视图、SiYuan 的 31 个 MCP 工具与 API token；它的 [架构](architecture.md)和[验证](verification.md)是独立历史记录。Eidos 版随包携带 14,166,512 B CLI，使用 Eidos 自带表格、普通 Markdown 页面和本版四个 MCP 工具，不启动 SiYuan、不读取其工作区，也没有复制其原生技能管理。两版各自的数据不会自动迁移。

Eidos CLI 来自 [mayneyao/eidos 的 3.3.2 发布版](https://github.com/mayneyao/eidos/releases/tag/cli-v3.3.2)，按 AGPL-3.0 分发；来源和许可证副本随二进制保存在 `resources/eidos/`。CLI 的全部 Rust 和平台依赖尚未逐项做 SBOM 审查。

## 改动清单

相对 `519972a` 的新增 / 删除行数；二进制文件列字节数。

| 文件 | 新增 / 删除 |
| --- | ---: |
| `README.md` | +8 / -12 |
| `docs/dev/references/ai/agent-prompt-layers.md` | +2 / -0 |
| `docs/eidos-demo.txt` | +5 / -0 |
| `docs/eidos-electron.png` | 二进制 112,815 B |
| `docs/eidos-version.md` | +95 / -0 |
| `electron-builder.yml` | +4 / -6 |
| `resources/eidos/AGPL-3.0.txt` | +661 / -0 |
| `resources/eidos/attribution.txt` | +6 / -0 |
| `resources/eidos/eidos-darwin-arm64` | 二进制 14,166,512 B |
| `scripts/memories-eidos/serve.ts` | +20 / -0 |
| `scripts/memories-eidos/smoke.mjs` | +57 / -0 |
| `src/main/ai/agents/prompt.ts` | +3 / -0 |
| `src/main/core/application/serviceRegistry.ts` | +2 / -0 |
| `src/main/core/paths/README.md` | +1 / -1 |
| `src/main/core/paths/__tests__/constants.test.ts` | +11 / -11 |
| `src/main/core/paths/constants.ts` | +5 / -5 |
| `src/main/core/paths/pathRegistry.ts` | +9 / -0 |
| `src/main/features/memories/EidosMemoriesService.ts` | +35 / -0 |
| `src/main/features/memories/eidosBackend.ts` | +479 / -0 |
| `src/main/features/memories/spacePage.ts` | +28 / -0 |
| `src/main/services/protocol/ProtocolService.ts` | +3 / -2 |
| `src/main/services/protocol/__tests__/ProtocolService.test.ts` | +12 / -0 |
| `src/shared/data/presets/mcpServers.ts` | +4 / -5 |
| `src/shared/data/presets/miniApps.ts` | +1 / -1 |
