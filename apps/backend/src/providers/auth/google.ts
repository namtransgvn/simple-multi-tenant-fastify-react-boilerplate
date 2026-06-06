import type { AuthProvider, TokenSet, UserProfile } from './interface.js'

interface GoogleTokenResponse {
  access_token: string
  id_token?: string
  refresh_token?: string
  expires_in?: number
}

interface GoogleIdTokenPayload {
  sub: string
  email: string
  name?: string
}

export class GoogleAuthProvider implements AuthProvider {
  readonly providerType = 'google'

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
  ) {}

  getAuthorizationUrl(state: string, redirectUri: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
    })
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`
  }

  async exchangeCodeForToken(code: string, redirectUri: string): Promise<TokenSet> {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`Google token exchange failed: ${response.status} ${body}`)
    }

    const data = (await response.json()) as GoogleTokenResponse
    return {
      accessToken: data.access_token,
      idToken: data.id_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
    }
  }

  async getUserProfile(tokenSet: TokenSet): Promise<UserProfile> {
    if (!tokenSet.idToken) {
      throw new Error('Google id_token missing from token set')
    }

    const parts = tokenSet.idToken.split('.')
    if (parts.length !== 3) {
      throw new Error('Invalid Google id_token format')
    }

    // Decode payload — trust the token endpoint response, no signature verification needed
    const payload = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf-8'),
    ) as GoogleIdTokenPayload

    return {
      subject: payload.sub,
      email: payload.email,
      displayName: payload.name ?? payload.email,
      providerType: this.providerType,
    }
  }
}
