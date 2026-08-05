// Ported from the web app's app/dashboard.tsx (rendered at the web app's "/"
// route). Same hero, same trusted-contacts preview and recent-sessions
// preview (both backed by the unchanged useContacts/useSessions hooks), same
// floating SOS button.
import { Link, useRouter } from 'expo-router'
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { AlertCircle, ArrowRight, MapPin, RefreshCw } from 'lucide-react-native'
import { BeaconDot } from '@/components/beacon-dot'
import { SOSButton } from '@/components/sos-button'
import { StatusBadge } from '@/components/status-badge'
import { useContacts, useSessions } from '@/lib/hooks'
import { colors } from '@/lib/theme'

export default function DashboardScreen() {
  const router = useRouter()
  const { contacts, loading: contactsLoading, error: contactsError, refresh } = useContacts()
  const { sessions, loading: sessionsLoading, error: sessionsError, refresh: refreshSessions } = useSessions()

  const recentSessions = sessions.slice(0, 3)
  const displayContacts = contacts.slice(0, 3)

  return (
    <View style={styles.flex}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={contactsLoading || sessionsLoading}
            onRefresh={() => {
              void refresh()
              void refreshSessions()
            }}
            tintColor={colors.beaconAmber}
          />
        }
      >
        <View style={styles.hero}>
          <BeaconDot size="lg" variant="pulse" style={styles.heroDot} />
          <Text style={styles.heroTitle}>You don&apos;t walk alone</Text>
          <Text style={styles.heroSubtitle}>
            Stay connected with trusted people while you move through the world. Proactive
            check-ins keep everyone at ease.
          </Text>
          <Link href="/session/new" asChild>
            <Pressable style={styles.heroButton}>
              <Text style={styles.heroButtonText}>Start a session</Text>
              <ArrowRight size={20} color={colors.inkIndigo} />
            </Pressable>
          </Link>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Trusted contacts</Text>
          {contactsLoading ? (
            <View style={styles.centeredBox}>
              <ActivityIndicator color={colors.beaconAmber} />
            </View>
          ) : contactsError ? (
            <View style={styles.errorRow}>
              <AlertCircle size={20} color={colors.alertCoral} />
              <Text style={styles.errorRowText}>{contactsError}</Text>
              <Pressable onPress={() => void refresh()} hitSlop={8}>
                <RefreshCw size={18} color={colors.alertCoral} />
              </Pressable>
            </View>
          ) : displayContacts.length > 0 ? (
            <View style={styles.contactsGrid}>
              {displayContacts.map((contact) => (
                <View key={contact.id} style={styles.contactCard}>
                  <View style={styles.contactAvatar}>
                    <View style={styles.contactAvatarDot} />
                  </View>
                  <View style={styles.flex1}>
                    <Text style={styles.contactName}>{contact.name}</Text>
                    <Text style={styles.mutedText}>{contact.relationship}</Text>
                    <Text style={styles.contactPhone}>{contact.phone}</Text>
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <View style={styles.emptyBox}>
              <Text style={styles.mutedText}>No trusted contacts yet</Text>
              <Link href="/contacts" style={styles.emptyLink}>
                Add your first contact
              </Link>
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recent sessions</Text>
          {sessionsLoading ? (
            <View style={styles.centeredBox}>
              <ActivityIndicator color={colors.beaconAmber} />
            </View>
          ) : sessionsError ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{sessionsError}</Text>
            </View>
          ) : recentSessions.length > 0 ? (
            <View style={styles.sessionsList}>
              {recentSessions.map((session) => (
                <Pressable
                  key={session.id}
                  onPress={() => router.push(`/session/active/${session.id}`)}
                  style={styles.sessionCard}
                >
                  <View style={styles.flex1}>
                    <Text style={styles.sessionName}>{session.name}</Text>
                    <Text style={styles.mutedText}>{session.checkpoints.length} checkpoints</Text>
                    <View style={styles.sessionMetaRow}>
                      <StatusBadge status={session.status} />
                      <Text style={styles.sessionDate}>
                        {new Date(session.started_at).toLocaleDateString()}
                      </Text>
                    </View>
                  </View>
                  <ArrowRight size={20} color={colors.mutedForeground} />
                </Pressable>
              ))}
            </View>
          ) : (
            <View style={styles.emptyBox}>
              <MapPin size={32} color={colors.mutedForeground} />
              <Text style={[styles.mutedText, styles.emptySpacing]}>No sessions yet</Text>
              <Link href="/session/new" style={styles.emptyLink}>
                Create your first session
              </Link>
            </View>
          )}
        </View>
      </ScrollView>

      <SOSButton onTrigger={() => console.log('[raahi] SOS button triggered from dashboard')} />
    </View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  flex1: { flex: 1 },
  scrollContent: { paddingBottom: 96 },
  hero: {
    backgroundColor: colors.dawnMist,
    paddingHorizontal: 24,
    paddingVertical: 48,
    alignItems: 'center',
  },
  heroDot: { marginBottom: 24 },
  heroTitle: {
    fontSize: 30,
    fontWeight: '700',
    color: colors.foreground,
    marginBottom: 12,
    textAlign: 'center',
  },
  heroSubtitle: {
    fontSize: 16,
    color: colors.mutedForeground,
    textAlign: 'center',
    marginBottom: 24,
  },
  heroButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.beaconAmber,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 12,
  },
  heroButtonText: { color: colors.inkIndigo, fontWeight: '700', fontSize: 15 },
  section: { paddingHorizontal: 16, paddingTop: 32 },
  sectionTitle: { fontSize: 22, fontWeight: '700', color: colors.foreground, marginBottom: 16 },
  centeredBox: { minHeight: 96, alignItems: 'center', justifyContent: 'center' },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 75, 92, 0.3)',
    backgroundColor: 'rgba(255, 75, 92, 0.1)',
    borderRadius: 12,
    padding: 16,
  },
  errorRowText: { flex: 1, fontSize: 14, color: colors.foreground },
  errorBox: {
    borderWidth: 1,
    borderColor: 'rgba(255, 75, 92, 0.3)',
    backgroundColor: 'rgba(255, 75, 92, 0.1)',
    borderRadius: 12,
    padding: 16,
  },
  errorText: { fontSize: 14, color: colors.foreground },
  contactsGrid: { gap: 12 },
  contactCard: {
    flexDirection: 'row',
    gap: 12,
    padding: 16,
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  contactAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 182, 72, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  contactAvatarDot: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.beaconAmber },
  contactName: { fontSize: 15, fontWeight: '600', color: colors.foreground },
  mutedText: { fontSize: 13, color: colors.mutedForeground },
  contactPhone: { fontSize: 12, color: colors.mutedForeground, marginTop: 8 },
  emptyBox: {
    alignItems: 'center',
    paddingVertical: 32,
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  emptySpacing: { marginBottom: 12, marginTop: 12 },
  emptyLink: { color: colors.beaconAmber, fontWeight: '600', fontSize: 14 },
  sessionsList: { gap: 12 },
  sessionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sessionName: { fontSize: 15, fontWeight: '600', color: colors.foreground, marginBottom: 4 },
  sessionMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  sessionDate: { fontSize: 12, color: colors.mutedForeground },
})
