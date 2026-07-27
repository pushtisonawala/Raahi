'use client'

interface StatusBadgeProps {
  status:
    | 'pending'
    | 'reached'
    | 'overdue'
    | 'pinged'
    | 'contacts_alerted'
    | 'completed'
    | 'escalated'
    | 'sos_triggered'
    | 'active'
  label?: string
}

const statusConfig = {
  pending: { bg: 'bg-slate-100', text: 'text-slate-700', label: 'Pending' },
  reached: { bg: 'bg-safe-teal/10', text: 'text-safe-teal', label: 'Reached' },
  overdue: { bg: 'bg-alert-coral/10', text: 'text-alert-coral', label: 'Overdue' },
  pinged: { bg: 'bg-alert-coral/10', text: 'text-alert-coral', label: 'Check in' },
  contacts_alerted: { bg: 'bg-alert-coral/10', text: 'text-alert-coral', label: 'Contacts alerted' },
  completed: { bg: 'bg-safe-teal/10', text: 'text-safe-teal', label: 'Completed' },
  escalated: { bg: 'bg-alert-coral/10', text: 'text-alert-coral', label: 'Escalated' },
  sos_triggered: { bg: 'bg-alert-coral/10', text: 'text-alert-coral', label: 'SOS triggered' },
  active: { bg: 'bg-beacon-amber/10', text: 'text-beacon-amber', label: 'Active' },
}

export function StatusBadge({ status, label }: StatusBadgeProps) {
  const config = statusConfig[status]
  const displayLabel = label || config.label

  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${config.bg} ${config.text}`}
    >
      {displayLabel}
    </span>
  )
}
