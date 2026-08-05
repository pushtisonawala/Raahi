// Ported from the web app's components/status-badge.tsx - same status ->
// color/label mapping, rendered as a pill View instead of a <span>.
import { StyleSheet, Text, View } from 'react-native'
import { colors } from '@/lib/theme'

type Status =
  | 'pending'
  | 'reached'
  | 'overdue'
  | 'pinged'
  | 'contacts_alerted'
  | 'completed'
  | 'escalated'
  | 'sos_triggered'
  | 'active'

type StatusBadgeProps = {
  status: Status
  label?: string
}

const statusConfig: Record<Status, { bg: string; text: string; label: string }> = {
  pending: { bg: '#F1F5F9', text: '#334155', label: 'Pending' },
  reached: { bg: 'rgba(72, 209, 184, 0.12)', text: colors.safeTeal, label: 'Reached' },
  overdue: { bg: 'rgba(255, 75, 92, 0.12)', text: colors.alertCoral, label: 'Overdue' },
  pinged: { bg: 'rgba(255, 75, 92, 0.12)', text: colors.alertCoral, label: 'Check in' },
  contacts_alerted: { bg: 'rgba(255, 75, 92, 0.12)', text: colors.alertCoral, label: 'Contacts alerted' },
  completed: { bg: 'rgba(72, 209, 184, 0.12)', text: colors.safeTeal, label: 'Completed' },
  escalated: { bg: 'rgba(255, 75, 92, 0.12)', text: colors.alertCoral, label: 'Escalated' },
  sos_triggered: { bg: 'rgba(255, 75, 92, 0.12)', text: colors.alertCoral, label: 'SOS triggered' },
  active: { bg: 'rgba(255, 182, 72, 0.12)', text: colors.beaconAmber, label: 'Active' },
}

export function StatusBadge({ status, label }: StatusBadgeProps) {
  const config = statusConfig[status]
  const displayLabel = label || config.label

  return (
    <View style={[styles.badge, { backgroundColor: config.bg }]}>
      <Text style={[styles.text, { color: config.text }]}>{displayLabel}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  text: {
    fontSize: 12,
    fontWeight: '500',
  },
})
