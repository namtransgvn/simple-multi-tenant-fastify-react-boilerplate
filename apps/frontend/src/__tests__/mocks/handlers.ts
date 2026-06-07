import { http, HttpResponse } from 'msw'

export const handlers = [
  http.get('http://localhost/auth/tenants', () => {
    return HttpResponse.json({
      tenants: [
        {
          id: '00000000-0000-0000-0000-000000000010',
          name: 'Master Tenant',
          slug: 'master',
          ssoProviders: ['google'],
        },
      ],
    })
  }),

  http.get('http://localhost/auth/sso', () => {
    return HttpResponse.json({
      providers: [
        {
          providerType: 'google',
          name: 'Google',
          authorizationUrl: 'http://localhost/auth/sso/google/authorize',
        },
        {
          providerType: 'keycloak',
          name: 'Keycloak',
          authorizationUrl: 'http://localhost/auth/sso/keycloak/authorize',
        },
      ],
    })
  }),
]
