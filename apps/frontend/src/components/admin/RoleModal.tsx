import { useState, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Permission } from '@repo/shared'
import type { RoleResponse } from '@repo/shared'
import { Dialog, DialogHeader, DialogTitle, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const ALL_PERMISSIONS = Object.values(Permission)

interface RoleModalProps {
  open: boolean
  onClose: () => void
  role?: RoleResponse | null
}

export function RoleModal({ open, onClose, role }: RoleModalProps) {
  const queryClient = useQueryClient()
  const isEdit = role != null
  const [name, setName] = useState('')
  const [selectedPerms, setSelectedPerms] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (open) {
      setName(role?.name ?? '')
      setSelectedPerms(new Set(role?.permissions ?? []))
    }
  }, [open, role])

  const mutation = useMutation({
    mutationFn: () => {
      const body = { name, permissions: Array.from(selectedPerms) }
      return isEdit
        ? api.put(`/api/admin/roles/${role.id}`, body)
        : api.post('/api/admin/roles', body)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'roles'] })
      onClose()
    },
  })

  function togglePerm(perm: string) {
    setSelectedPerms((prev) => {
      const next = new Set(prev)
      if (next.has(perm)) next.delete(perm)
      else next.add(perm)
      return next
    })
  }

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>{isEdit ? 'Edit Role' : 'New Role'}</DialogTitle>
      </DialogHeader>
      <DialogContent>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Role name"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Permissions</label>
            <div className="grid grid-cols-1 gap-2 max-h-48 overflow-y-auto pr-1">
              {ALL_PERMISSIONS.map((perm) => (
                <label key={perm} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedPerms.has(perm)}
                    onChange={() => togglePerm(perm)}
                    className="rounded border-border"
                  />
                  {perm}
                </label>
              ))}
            </div>
          </div>
          {mutation.error && (
            <p className="text-sm text-destructive">{(mutation.error as Error).message}</p>
          )}
        </div>
      </DialogContent>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          onClick={() => mutation.mutate()}
          disabled={!name.trim() || mutation.isPending}
        >
          {mutation.isPending ? 'Saving…' : 'Save'}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
