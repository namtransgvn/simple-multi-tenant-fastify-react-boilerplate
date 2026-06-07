import { createPortal } from 'react-dom'
import { Button } from './button'

interface AlertDialogProps {
  open: boolean
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
}

export function AlertDialog({
  open,
  title,
  description,
  confirmLabel = 'Continue',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}: AlertDialogProps) {
  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50" onClick={onCancel} aria-hidden />
      <div
        role="alertdialog"
        aria-modal
        aria-labelledby="alert-dialog-title"
        aria-describedby="alert-dialog-description"
        className="relative z-10 w-full max-w-sm rounded-lg bg-background p-6 shadow-lg"
      >
        <h2 id="alert-dialog-title" className="text-lg font-semibold">
          {title}
        </h2>
        <p id="alert-dialog-description" className="mt-2 text-sm text-muted-foreground">
          {description}
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
