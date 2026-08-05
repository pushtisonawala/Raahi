// Ported from the web app's app/history/page.tsx. Same filter chips and
// timeline-style session list, backed by the unchanged useSessions hook.
import { useState } from 'react'
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import { Link } from 'expo-router'
import { AlertCircle, Clock } from 'lucide-react-native'
import { useSessions } from '@/lib/hooks'
import { StatusBadge } from '@/components/status-badge'
import { colors } from '@/lib/theme'

const FILTERS = ['all', 'completed', 'escalated', 'sos_triggered'] as const
type Filter = (typeof FILTERS)[number]

export default function HistoryScreen() {
  const { sessions, loading, error } = useSessions()
  const [filterStatus, setFilterStatus] = useState<Filter>('all')

  const filteredSessions =
    filterStatus === 'all' ? sessions : sessions.filter((s) => s.status === filterStatus)

  const formatDate = (timestamp: string) =>
    new Date(timestamp).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })

  const formatDuration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
  }

  return (
    <View style={styles.flex}>
      <View style={styles.headerBlock}>
        <Text style={styles.title}>Session history</Text>
        <Text style={styles.subtitle}>Your past check-ins and safety sessions</Text>
      </View>

      <View style={styles.filterRow}>
        {FILTERS.map((status) => (
          <Pressable
            key={status}
            onPress={() => setFilterStatus(status)}
            style={[styles.filterChip, filterStatus === status && styles.filterChipActive]}
          >
            <Text
              style={[styles.filterChipText, filterStatus === status && styles.filterChipTextActive]}
            >
              {status === 'sos_triggered' ? 'SOS' : status}
            </Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <View style={styles.centeredBox}>
          <ActivityIndicator color={colors.beaconAmber} size="large" />
        </View>
      ) : error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : (
        <FlatList
          data={filteredSessions}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <Clock size={40} color={colors.mutedForeground} />
              <Text style={[styles.emptyTitle, styles.emptySpacing]}>No session history</Text>
              <Text style={[styles.mutedText, styles.emptySpacing]}>
                {filterStatus === 'all'
                  ? "You haven't started any sessions yet."
                  : `No ${filterStatus} sessions yet.`}
              </Text>
              <Link href="/session/new" style={styles.emptyLink}>
                Create your first session
              </Link>
            </View>
          }
          renderItem={({ item: session }) => {
            const endTime = session.completed_at
              ? new Date(session.completed_at).getTime()
              : Date.now()
            const duration = Math.max(
              0,
              Math.floor((endTime - new Date(session.started_at).getTime()) / 1000)
            )
            const hasEscalation = session.checkpoints.some((checkpoint) =>
              ['overdue', 'pinged', 'contacts_alerted'].includes(checkpoint.status)
            )
            const isAlert = session.status === 'escalated' || session.status === 'sos_triggered'

            return (
              <View style={[styles.sessionCard, isAlert && styles.sessionCardAlert]}>
                <View style={styles.sessionHeaderRow}>
                  <View style={styles.flex1}>
                    <Text style={styles.sessionName}>{session.name}</Text>
                    <Text style={styles.mutedText}>{session.route}</Text>
                  </View>
                  <StatusBadge status={session.status} />
                </View>

                <View style={styles.metaGrid}>
                  <View style={styles.metaItem}>
                    <Text style={styles.metaLabel}>Date</Text>
                    <Text style={styles.metaValue}>{formatDate(session.started_at)}</Text>
                  </View>
                  <View style={styles.metaItem}>
                    <Text style={styles.metaLabel}>Duration</Text>
                    <Text style={styles.metaValue}>{formatDuration(duration)}</Text>
                  </View>
                  <View style={styles.metaItem}>
                    <Text style={styles.metaLabel}>Checkpoints</Text>
                    <Text style={styles.metaValue}>{session.checkpoints.length}</Text>
                  </View>
                </View>

                {session.checkpoints.length > 0 && (
                  <View style={styles.checkpointsBlock}>
                    <Text style={styles.checkpointsLabel}>Checkpoints:</Text>
                    {session.checkpoints.map((checkpoint) => (
                      <View key={checkpoint.id} style={styles.checkpointRow}>
                        {['overdue', 'pinged', 'contacts_alerted'].includes(checkpoint.status) ? (
                          <AlertCircle size={16} color={colors.alertCoral} />
                        ) : checkpoint.status === 'reached' ? (
                          <View style={styles.dotTeal} />
                        ) : (
                          <View style={styles.dotMuted} />
                        )}
                        <Text style={styles.checkpointName}>{checkpoint.name}</Text>
                        {checkpoint.expected_time && (
                          <Text style={styles.mutedText}>
                            {new Date(checkpoint.expected_time).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </Text>
                        )}
                      </View>
                    ))}
                  </View>
                )}

                {hasEscalation && (
                  <View style={styles.escalationBox}>
                    <AlertCircle size={18} color={colors.alertCoral} />
                    <View style={styles.flex1}>
                      <Text style={styles.escalationTitle}>Emergency escalation</Text>
                      <Text style={styles.escalationText}>
                        Contacts were notified due to missed checkpoints.
                      </Text>
                    </View>
                  </View>
                )}
              </View>
            )
          }}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  flex1: { flex: 1 },
  headerBlock: { paddingHorizontal: 16, paddingTop: 24, paddingBottom: 8 },
  title: { fontSize: 26, fontWeight: '700', color: colors.foreground },
  subtitle: { fontSize: 14, color: colors.mutedForeground, marginTop: 4 },
  filterRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 16, flexWrap: 'wrap' },
  filterChip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10, backgroundColor: colors.muted },
  filterChipActive: { backgroundColor: colors.beaconAmber },
  filterChipText: { fontSize: 13, fontWeight: '600', color: colors.foreground, textTransform: 'capitalize' },
  filterChipTextActive: { color: colors.inkIndigo },
  centeredBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorBox: {
    marginHorizontal: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 75, 92, 0.3)',
    backgroundColor: 'rgba(255, 75, 92, 0.1)',
    borderRadius: 12,
    padding: 16,
  },
  errorText: { fontSize: 14, color: colors.foreground },
  listContent: { paddingHorizontal: 16, paddingBottom: 32, gap: 16 },
  emptyBox: {
    alignItems: 'center',
    paddingVertical: 48,
    paddingHorizontal: 24,
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.border,
  },
  emptyTitle: { fontSize: 17, fontWeight: '600', color: colors.foreground },
  emptySpacing: { marginTop: 12, textAlign: 'center' },
  emptyLink: { color: colors.beaconAmber, fontWeight: '600', fontSize: 14, marginTop: 16 },
  mutedText: { fontSize: 13, color: colors.mutedForeground },
  sessionCard: {
    padding: 20,
    borderRadius: 12,
    borderWidth: 1,
    backgroundColor: colors.card,
    borderColor: colors.border,
  },
  sessionCardAlert: { backgroundColor: 'rgba(255, 75, 92, 0.05)', borderColor: 'rgba(255, 75, 92, 0.5)' },
  sessionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  sessionName: { fontSize: 17, fontWeight: '700', color: colors.foreground },
  metaGrid: { flexDirection: 'row', gap: 16, backgroundColor: 'rgba(85, 107, 146, 0.06)', borderRadius: 10, padding: 12, marginTop: 8 },
  metaItem: { flex: 1 },
  metaLabel: { fontSize: 11, color: colors.mutedForeground },
  metaValue: { fontSize: 13, fontWeight: '600', color: colors.foreground, marginTop: 2 },
  checkpointsBlock: { marginTop: 16, gap: 8 },
  checkpointsLabel: { fontSize: 11, fontWeight: '600', color: colors.mutedForeground },
  checkpointRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 8,
    backgroundColor: 'rgba(85, 107, 146, 0.05)',
    borderRadius: 8,
  },
  checkpointName: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.foreground },
  dotTeal: { width: 14, height: 14, borderRadius: 7, backgroundColor: colors.safeTeal },
  dotMuted: { width: 14, height: 14, borderRadius: 7, backgroundColor: colors.muted },
  escalationBox: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    marginTop: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 75, 92, 0.3)',
    backgroundColor: 'rgba(255, 75, 92, 0.1)',
    borderRadius: 10,
  },
  escalationTitle: { fontSize: 11, fontWeight: '600', color: colors.alertCoral },
  escalationText: { fontSize: 11, color: colors.mutedForeground, marginTop: 4 },
})
