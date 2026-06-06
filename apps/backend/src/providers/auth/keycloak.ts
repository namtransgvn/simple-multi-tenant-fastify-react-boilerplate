import type { AuthProvider, TokenSet, UserProfile } from './interface.js'

interface OidcDiscovery {
  authorization_endpoint: string
  token_endpoint: string
  userinfo_endpoint: string
}

interface KeycloakTokenResponse {
  access_token: string
  id_token?: string
  refresh_token?: string
  expires_in?: number
}

interface KeycloakUserInfoResponse {
  sub: string
  email: string
  name?: string
  preferred_username?: string
}

export class KeycloakAuthProvider implements AuthProvider {
  readonly providerType = 'keycloak'

  private constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly authorizationEndpoint: string,
    private readonly tokenEndpoint: string,
    private readonly userInfoEndpoint: string,
  ) {}

  static async create(
    clientId: string,
    clientSecret: string,
    issuerUrl: string,
  ): Promise<KeycloakAuthProvider> {
    const discoveryUrl = `${issuerUrl.replace(/\/$/, '')}/.well-known/openid-configuration`
    const response = await fetch(discoveryUrl)
    if (!response.ok) {
      throw new Error(`Keycloak OIDC discovery failed at ${discoveryUrl}: ${response.status}`)
    }
    const discovery = (await response.json()) as OidcDiscovery
    return new KeycloakAuthProvider(
      clientId,
      clientSecret,
      discovery.authorization_endpoint,
      discovery.token_endpoint,
      discovery.userinfo_endpoint,
    )
  }

  getAuthorizationUrl(state: string, redirectUri: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
    })
    return `${this.authorizationEndpoint}?${params}`
  }

  async exchangeCodeForToken(code: string, redirectUri: string): Promise<TokenSet> {
    const response = await fetch(this.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }),
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`Keycloak token exchange failed: ${response.status} ${body}`)
    }

    const data = (await response.json()) as KeycloakTokenResponse
    return {
      accessToken: data.access_token,
      idToken: data.id_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
    }
  }

  async getUserProfile(tokenSet: TokenSet): Promise<UserProfile> {
    const response = await fetch(this.userInfoEndpoint, {
      headers: { Authorization: `Bearer ${tokenSet.accessToken}` },
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`Keycloak userInfo request failed: ${response.status} ${body}`)
    }

    const data = (await response.json()) as KeycloakUserInfoResponse

    return {
      subject: data.sub,
      email: data.email,
      displayName: data.name ?? data.preferred_username ?? data.email,
      providerType: this.providerType,
    }
  }
}
