import { eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '../../db/schema/index.js'
import type { AuthProvider } from './interface.js'
import { GoogleAuthProvider } from './google.js'
import { AmazonCognitoAuthProvider } from './amazon-cognito.js'
import { KeycloakAuthProvider } from './keycloak.js'

export class AuthProviderFactory {
  private readonly providers = new Map<string, AuthProvider>()

  register(provider: AuthProvider): void {
    this.providers.set(provider.providerType, provider)
  }

  clear(): void {
    this.providers.clear()
  }

  resolve(providerType: string): AuthProvider {
    const provider = this.providers.get(providerType)
    if (!provider) {
      throw new Error(`No auth provider registered for type "${providerType}"`)
    }
    return provider
  }

  listProviderTypes(): string[] {
    return Array.from(this.providers.keys())
  }
}

export const authProviderFactory = new AuthProviderFactory()

export async function initAuthProviders(
  db: PostgresJsDatabase<typeof schema>,
): Promise<void> {
  authProviderFactory.clear()

  const rows = await db
    .select()
    .from(schema.ssoProviders)
    .where(eq(schema.ssoProviders.enabled, true))

  for (const row of rows) {
    try {
      switch (row.providerType) {
        case 'google':
          authProviderFactory.register(new GoogleAuthProvider(row.clientId, row.clientSecret))
          break
        case 'amazon-cognito':
          if (!row.issuerUrl) {
            process.stderr.write(`[auth] amazon-cognito provider skipped: missing issuer_url\n`)
            break
          }
          authProviderFactory.register(
            new AmazonCognitoAuthProvider(row.clientId, row.clientSecret, row.issuerUrl),
          )
          break
        case 'keycloak': {
          if (!row.issuerUrl) {
            process.stderr.write(`[auth] keycloak provider skipped: missing issuer_url\n`)
            break
          }
          const provider = await KeycloakAuthProvider.create(
            row.clientId,
            row.clientSecret,
            row.issuerUrl,
          )
          authProviderFactory.register(provider)
          break
        }
        default:
          process.stderr.write(`[auth] Unknown provider type "${row.providerType}" — skipped\n`)
      }
    } catch (err) {
      process.stderr.write(
        `[auth] Provider "${row.providerType}" skipped: ${err instanceof Error ? err.message : String(err)}\n`,
      )
    }
  }
}
