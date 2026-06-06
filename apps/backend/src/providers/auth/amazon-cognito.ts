import type { AuthProvider, TokenSet, UserProfile } from './interface.js'

interface CognitoTokenResponse {
  access_token: string
  id_token?: string
  refresh_token?: string
  expires_in?: number
}

interface CognitoUserInfoResponse {
  sub: string
  email: string
  name?: string
  given_name?: string
  family_name?: string
}

export class AmazonCognitoAuthProvider implements AuthProvider {
  readonly providerType = 'amazon-cognito'

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly issuerUrl: string,
  ) {}

  getAuthorizationUrl(state: string, redirectUri: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
    })
    return `${this.issuerUrl}/oauth2/authorize?${params}`
  }

  async exchangeCodeForToken(code: string, redirectUri: string): Promise<TokenSet> {
    const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')

    const response = await fetch(`${this.issuerUrl}/oauth2/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${credentials}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`Cognito token exchange failed: ${response.status} ${body}`)
    }

    const data = (await response.json()) as CognitoTokenResponse
    return {
      accessToken: data.access_token,
      idToken: data.id_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
    }
  }

  async getUserProfile(tokenSet: TokenSet): Promise<UserProfile> {
    const response = await fetch(`${this.issuerUrl}/oauth2/userInfo`, {
      headers: { Authorization: `Bearer ${tokenSet.accessToken}` },
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`Cognito userInfo request failed: ${response.status} ${body}`)
    }

    const data = (await response.json()) as CognitoUserInfoResponse

    const fullName = [data.given_name, data.family_name].filter(Boolean).join(' ')
    const displayName = data.name ?? (fullName || data.email)

    return {
      subject: data.sub,
      email: data.email,
      displayName,
      providerType: this.providerType,
    }
  }
}
