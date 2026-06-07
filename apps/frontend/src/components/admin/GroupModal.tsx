import { useState, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { RoleResponse } from '@repo/shared'
import { Dialog, DialogHeader, DialogTitle, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface GroupModalProps {
  open: boolean
  onClose: () => void
}

export function GroupModal({ open, onClose }: GroupModalProps) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [selectedRoleIds, setSelectedRoleIds] = useState<Set<string>>(new Set())

  const { data: rolesData } = useQuery({
    queryKey: ['admin', 'roles'],
    queryFn: () => api.get<{ items: RoleResponse[] }>('/api/admin/roles'),
    enabled: open,
  })

  useEffect(() => {
    if (open) {
      setName('')
      setSelectedRoleIds(new Set())
    }
  }, [open])

  const mutation = useMutation({
    mutationFn: () =>
      api.post('/api/admin/groups', { name, roleIds: Array.from(selectedRoleIds) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'groups'] })
      onClose()
    },
  })

  function toggleRole(roleId: string) {
    setSelectedRoleIds((prev) => {
      const next = new Set(prev)
      if (next.has(roleId)) next.delete(roleId)
      else next.add(roleId)
      return next
    })
  }

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>New Group</DialogTitle>
      </DialogHeader>
      <DialogContent>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Group name"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Roles</label>
            <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
              {rolesData?.items.map((role) => (
                <label key={role.id} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedRoleIds.has(role.id)}
                    onChange={() => toggleRole(role.id)}
                    className="rounded border-border"
                  />
                  {role.name}
                </label>
              ))}
              {rolesData?.items.length === 0 && (
                <p className="text-sm text-muted-foreground">No roles available.</p>
              )}
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
          {mutation.isPending ? 'Creating…' : 'Create'}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
