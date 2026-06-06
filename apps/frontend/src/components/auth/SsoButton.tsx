import type { SsoProvider } from '@repo/shared'
import { Button } from '@/components/ui/button'

interface SsoButtonProps {
  provider: SsoProvider
}

function ProviderAvatar({ name }: { readonly name: string | undefined }) {
  return (
    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-xs font-bold uppercase leading-none">
      {name ? name.charAt(0) : '?'}
    </span>
  )
}

export function SsoButton({ provider }: SsoButtonProps) {
  const label = provider.name ?? 'Unknown Provider'
  return (
    <Button
      variant="outline"
      className="w-full"
      onClick={() => {
        window.location.href = provider.authorizationUrl
      }}
    >
      <ProviderAvatar name={provider.name} />
      Continue with {label}
    </Button>
  )
}
