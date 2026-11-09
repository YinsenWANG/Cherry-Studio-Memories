import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'

import { startEidosBackend } from './eidosBackend'

const logger = loggerService.withContext('EidosMemoriesService')

@Injectable('EidosMemoriesService')
@ServicePhase(Phase.WhenReady)
export class EidosMemoriesService extends BaseService {
  private stopBackend?: () => Promise<void>

  protected async onInit(): Promise<void> {
    if (process.platform !== 'darwin' || process.arch !== 'arm64') {
      logger.warn('The Eidos prototype currently bundles only macOS arm64')
      return
    }
    try {
      this.stopBackend = await startEidosBackend({
        binary: application.getPath('feature.memories.binary_file'),
        file: application.getPath('feature.memories.file'),
        pages: application.getPath('feature.memories.pages'),
        log: (message, error) => (error ? logger.error(message, error) : logger.info(message))
      })
    } catch (error) {
      logger.error('Could not start the Eidos Memories space', error as Error)
    }
  }

  protected async onStop(): Promise<void> {
    await this.stopBackend?.()
    this.stopBackend = undefined
  }
}
