import { spawn, type ChildProcess } from 'node:child_process'
import { readFile } from 'node:fs/promises'

import { application } from '@application'
import { mcpServerService } from '@data/services/McpServerService'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { getAppLanguage } from '@main/i18n'
import { BuiltinMcpServerNames } from '@shared/utils/mcp'
import { redactSecretText } from '@shared/utils/redaction'

const logger = loggerService.withContext('SpaceService')
const localMcpUrl = 'http://127.0.0.1:16807/mcp'

@Injectable('SpaceService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['McpCatalogService'])
export class SpaceService extends BaseService {
  private child: ChildProcess | undefined

  protected async onReady(): Promise<void> {
    const server = mcpServerService.findByIdOrName(BuiltinMcpServerNames.sharedMemories)
    const remote =
      server?.installSource === 'builtin' && server.baseUrl && server.baseUrl !== localMcpUrl
        ? new URL(server.baseUrl)
        : undefined
    const authorization = Object.entries(server?.headers ?? {}).find(
      ([key]) => key.toLowerCase() === 'authorization'
    )?.[1]
    const token = authorization?.replace(/^Bearer\s+/i, '')
    if (remote) remote.pathname = remote.pathname.replace(/\/mcp\/?$/, '') || '/'

    const child = spawn(application.getPath('app.exe_file'), [application.getPath('feature.space.launcher_file')], {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        MEMORIES_HOME: application.getPath('feature.space.data'),
        SIYUAN_WORKSPACE: application.getPath('feature.space.workspace'),
        MEMORIES_MODULE_ROOT: application.getPath('app.root'),
        MEMORIES_I18NEXT_FILE: application.getPath('feature.space.i18next_file'),
        MEMORIES_LOCALES_DIR: application.getPath('feature.space.locales'),
        MEMORIES_LANGUAGE: getAppLanguage(),
        SIYUAN_URL: remote?.toString() ?? 'http://127.0.0.1:16807',
        SIYUAN_TOKEN: remote ? (token ?? '') : ''
      },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    this.child = child
    let output = ''
    child.stdout?.on('data', (data: Buffer) => {
      output += data.toString()
      const lines = output.split('\n')
      output = lines.pop() ?? ''
      if (lines.includes('CHERRY_SPACE_READY')) void this.connectSpace()
    })
    child.stderr?.on('data', (data: Buffer) => logger.warn(redactSecretText(data.toString())))
    child.once('error', (error) => logger.error('Space launcher failed', error))
    child.once('exit', (code) => {
      if (this.child === child) this.child = undefined
      if (code && this.isReady) logger.warn('Space launcher exited', { code })
    })
  }

  protected async onStop(): Promise<void> {
    this.child?.kill('SIGTERM')
    this.child = undefined
  }

  private async connectSpace(): Promise<void> {
    try {
      let server = mcpServerService.findByIdOrName(BuiltinMcpServerNames.sharedMemories)
      if (!server || server.installSource !== 'builtin') return
      const hasAuthorization = Object.entries(server.headers ?? {}).some(
        ([key, value]) => key.toLowerCase() === 'authorization' && value
      )
      if (server.baseUrl === localMcpUrl && !hasAuthorization) {
        const config = JSON.parse(await readFile(application.getPath('feature.space.workspace_conf_file'), 'utf8'))
        if (typeof config.api?.token !== 'string' || !config.api.token) throw new Error('SiYuan API token is missing')
        server = mcpServerService.findByIdOrName(BuiltinMcpServerNames.sharedMemories)
        if (!server || server.installSource !== 'builtin') return
        const updatedAuthorization = Object.entries(server.headers ?? {}).some(
          ([key, value]) => key.toLowerCase() === 'authorization' && value
        )
        if (server.baseUrl === localMcpUrl && !updatedAuthorization) {
          const headers = Object.fromEntries(
            Object.entries(server.headers ?? {}).filter(([key]) => key.toLowerCase() !== 'authorization')
          )
          mcpServerService.update(server.id, { headers: { ...headers, Authorization: `Bearer ${config.api.token}` } })
        }
      }
      if (server.isActive) await application.get('McpRuntimeService').restartServer(server.id)
    } catch (error) {
      logger.error('Could not connect the Space MCP server', error as Error)
    }
  }
}
