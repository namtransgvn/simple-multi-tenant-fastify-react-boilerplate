import type { FastifyInstance } from 'fastify'
import { db } from '../db/index.js'
import { aiProviderFactory } from '../providers/ai/factory.js'
import { authProviderFactory } from '../providers/auth/factory.js'
import { tenantAiProvidersService } from '../services/tenant-ai-providers.service.js'

async function providersRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /api/providers — tenant-scoped list of usable AI providers + models
  fastify.get('/', async (request) => {
    const tenantId = request.tenantId!

    const [effectiveProviderTypes, tenantConfigs] = await Promise.all([
      tenantAiProvidersService.getEffectiveProviders(tenantId, db),
      tenantAiProvidersService.listProviders(tenantId, db),
    ])

    const allowedModelsMap = new Map(
      tenantConfigs.map((cfg) => [cfg.providerType, cfg.allowedModels]),
    )

    const providers = effectiveProviderTypes.flatMap((providerType) => {
      let factoryModels: string[]
      try {
        factoryModels = aiProviderFactory.getSupportedModels(providerType)
      } catch {
        // Provider in DB but not registered in factory — skip
        return []
      }

      const allowedModels = allowedModelsMap.get(providerType) ?? []
      const models =
        allowedModels.length > 0
          ? factoryModels.filter((m) => allowedModels.includes(m))
          : factoryModels

      return [{ provider: providerType, models }]
    })

    return { providers }
  })

  // GET /api/providers/sso — public, used by login screen
  fastify.get('/sso', { config: { public: true, skipTenantGuard: true } }, async () => {
    return { providers: authProviderFactory.listProviderTypes() }
  })
}

export default providersRoutes
