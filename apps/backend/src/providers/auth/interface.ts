export interface TokenSet {
  accessToken: string
  idToken?: string
  refreshToken?: string
  expiresIn?: number
}

export interface UserProfile {
  subject: string
  email: string
  displayName: string
  providerType: string
}

export interface AuthProvider {
  readonly providerType: string
  getAuthorizationUrl(state: string, redirectUri: string): string
  exchangeCodeForToken(code: string, redirectUri: string): Promise<TokenSet>
  getUserProfile(tokenSet: TokenSet): Promise<UserProfile>
}
