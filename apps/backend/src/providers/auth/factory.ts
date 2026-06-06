import { config } from '../../config.js'
import type { AuthProvider } from './interface.js'
import { GoogleAuthProvider } from './google.js'
import { AmazonCognitoAuthProvider } from './amazon-cognito.js'
import { KeycloakAuthProvider } from './keycloak.js'

export class AuthProviderFactory {
  private readonly providers = new Map<string, AuthProvider>()

  register(provider: AuthProvider): void {
    this.providers.set(provider.providerType, provider)
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

const { google, cognito, keycloak } = config.sso

if (google.clientId && google.clientSecret) {
  authProviderFactory.register(new GoogleAuthProvider(google.clientId, google.clientSecret))
}

if (cognito.clientId && cognito.clientSecret && cognito.issuerUrl) {
  authProviderFactory.register(
    new AmazonCognitoAuthProvider(cognito.clientId, cognito.clientSecret, cognito.issuerUrl),
  )
}

if (keycloak.clientId && keycloak.clientSecret && keycloak.issuerUrl) {
  try {
    const provider = await KeycloakAuthProvider.create(
      keycloak.clientId,
      keycloak.clientSecret,
      keycloak.issuerUrl,
    )
    authProviderFactory.register(provider)
  } catch (err) {
    // Credentials present but Keycloak unreachable at startup — skip registration
    process.stderr.write(
      `[auth] Keycloak provider skipped: ${err instanceof Error ? err.message : String(err)}\n`,
    )
  }
}
