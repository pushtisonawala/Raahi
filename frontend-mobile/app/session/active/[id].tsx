// Ported from the web app's app/session/active/[id]/page.tsx. Same
// useSessionData (REST + WebSocket) and useLiveLocation hooks; the web
// version embedded OpenStreetMap in an <iframe>, here the identical embed URL
// is loaded in a WebView, with a "open in Maps" action via Linking for
// parity with the web app's external link.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocalSearchParams, useRouter } from 'expo-router'
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { WebView } from 'react-native-webview'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { AlertCircle, CheckCircle2, Clock, ExternalLink, Home, MapPin, Zap } from 'lucide-react-native'
import { BeaconDot } from '@/components/beacon-dot'
import { SOSButton } from '@/components/sos-button'
import { StatusBadge } from '@/components/status-badge'
import { apiFetch } from '@/lib/api'
import { useAuth } from '@/lib/auth-context'
import { useContacts } from '@/lib/hooks'
import { useLiveLocation } from '@/lib/hooks/useLiveLocation'
import { useSessionData } from '@/lib/hooks/useSessionData'
import { getRouteCheckpoints } from '@/lib/route'
import { colors } from '@/lib/theme'

// How many consecutive off-route location pings (each ~10-15s apart, see
// useLiveLocation) it takes before we auto-reroute, and how long to wait
// after a reroute before trying again. The original design just froze
// progress the moment you were more than 60m from the one path OSRM picked
// at session start - fine if you walk that exact path, wrong the moment you
// take a shortcut, a different street, or a closed road gets in the way.
// Requiring a streak (not a single ping) avoids rerouting on one noisy GPS
// blip; the cooldown avoids hammering the routing API/backend if deviation
// persists across many pings in a row.
const OFF_ROUTE_STREAK_THRESHOLD = 3
const REROUTE_COOLDOWN_MS = 60_000

export default function SessionActiveScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const sessionId = id
  const { token } = useAuth()
  const insets = useSafeAreaInsets()

  const { session, loading } = useSessionData(sessionId)
  const [isRerouting, setIsRerouting] = useState(false)
  const [rerouteError, setRerouteError] = useState<string | null>(null)
  const offRouteStreakRef = useRef(0)
  const lastRerouteAtRef = useRef(0)
  const { contacts } = useContacts()
  // Keep sending location updates through 'sos_triggered' too, not just
  // 'active' - stopping live tracking the instant someone asks for help is
  // exactly backwards for a safety app; that's when your contacts most need
  // an up-to-date position, not a frozen one.
  const isActive = session?.status === 'active' || session?.status === 'sos_triggered'
  const { status: locationStatus, lastSent } = useLiveLocation(sessionId, isActive)

  const [elapsedTime, setElapsedTime] = useState(0)
  const [showCountdownModal, setShowCountdownModal] = useState(false)
  const [showEscalationModal, setShowEscalationModal] = useState(false)
  const [isSendingSOS, setIsSendingSOS] = useState(false)

  const checkpoints = session?.checkpoints ?? []
  const currentCheckpointIndex = useMemo(
    () => checkpoints.findIndex((checkpoint) => checkpoint.status !== 'reached'),
    [checkpoints]
  )

  const liveMapUrl = useMemo(() => {
    if (!lastSent) return null
    const offset = 0.008
    const bbox = [
      lastSent.lng - offset,
      lastSent.lat - offset,
      lastSent.lng + offset,
      lastSent.lat + offset,
    ].join(',')
    return `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${encodeURIComponent(`${lastSent.lat},${lastSent.lng}`)}`
  }, [lastSent])

  useEffect(() => {
    if (!session) return
    const start = new Date(session.started_at).getTime()
    const updateElapsedTime = () => setElapsedTime(Math.max(0, Math.floor((Date.now() - start) / 1000)))
    updateElapsedTime()
    const interval = setInterval(updateElapsedTime, 1000)
    return () => clearInterval(interval)
  }, [session])

  useEffect(() => {
    setShowCountdownModal(checkpoints.some((checkpoint) => checkpoint.status === 'pinged'))
    setShowEscalationModal(checkpoints.some((checkpoint) => checkpoint.status === 'contacts_alerted'))
  }, [checkpoints])

  // Recomputes a route from wherever the walker currently is to the same
  // destination, using the exact same lib/route.ts lookup the wizard used to
  // build the original route (same mode, same mismatch/pace validation,
  // same traffic buffer for driving), then hands it to the backend's
  // /reroute endpoint to swap in as the new plan. This is what turns
  // "off route" from a dead end into "recalculating," the way turn-by-turn
  // nav apps behave.
  const handleReroute = async (destLat: number, destLng: number) => {
    if (!sessionId || !lastSent) return
    setIsRerouting(true)
    setRerouteError(null)
    try {
      const mode = session?.travel_mode === 'driving' ? 'driving' : 'walking'
      const result = await getRouteCheckpoints(
        lastSent.lat,
        lastSent.lng,
        destLat,
        destLng,
        new Date(),
        mode
      )
      await apiFetch(
        `/sessions/${encodeURIComponent(sessionId)}/reroute`,
        {
          method: 'POST',
          body: JSON.stringify({
            checkpoints: result.checkpoints,
            route_geometry: result.geometry,
          }),
        },
        token
      )
      // The backend broadcasts a websocket event on success, which
      // useSessionData's onmessage handler picks up to refetch - no manual
      // refresh needed here.
    } catch (error) {
      setRerouteError(
        error instanceof Error ? error.message : 'Could not recalculate the route.'
      )
    } finally {
      setIsRerouting(false)
    }
  }

  useEffect(() => {
    if (!session || session.status !== 'active' || !lastSent) {
      offRouteStreakRef.current = 0
      return
    }
    if (!session.route_total_meters) return // no route to recalculate against

    if (!session.route_deviation) {
      offRouteStreakRef.current = 0
      return
    }

    offRouteStreakRef.current += 1
    if (offRouteStreakRef.current < OFF_ROUTE_STREAK_THRESHOLD) return
    if (isRerouting) return
    if (Date.now() - lastRerouteAtRef.current < REROUTE_COOLDOWN_MS) return

    const destination = session.checkpoints.find((checkpoint) => checkpoint.name === 'Destination')
    if (!destination || destination.lat === null || destination.lng === null) return

    offRouteStreakRef.current = 0
    lastRerouteAtRef.current = Date.now()
    void handleReroute(destination.lat, destination.lng)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, lastSent, isRerouting])

  const handleCompleteSession = async () => {
    if (!sessionId) return
    await apiFetch(`/sessions/${encodeURIComponent(sessionId)}/complete`, { method: 'POST' }, token)
    router.replace('/history')
  }

  const handleSOS = async () => {
    if (!sessionId || isSendingSOS) return
    // The old version awaited this with no try/catch at all - a failed
    // request (network blip, expired token, backend hiccup) just vanished
    // into an unhandled promise rejection with zero feedback, which is
    // exactly why pressing SOS could feel like "nothing happened." Now a
    // failure surfaces immediately and can be retried, and success shows an
    // unmistakable confirmation instead of only a small status-badge change.
    setIsSendingSOS(true)
    try {
      await apiFetch(`/sessions/${encodeURIComponent(sessionId)}/sos`, { method: 'POST' }, token)
    } catch (error) {
      Alert.alert(
        'SOS failed to send',
        error instanceof Error
          ? error.message
          : 'Could not reach the server. Check your connection and try again.',
        [{ text: 'Try again', onPress: () => void handleSOS() }, { text: 'Cancel', style: 'cancel' }]
      )
    } finally {
      setIsSendingSOS(false)
    }
  }

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  }

  if (loading) {
    return (
      <View style={styles.centeredScreen}>
        <ActivityIndicator size="large" color={colors.beaconAmber} />
      </View>
    )
  }

  if (!session) {
    return (
      <View style={styles.centeredScreen}>
        <AlertCircle size={48} color={colors.mutedForeground} />
        <Text style={[styles.mutedText, styles.notFoundSpacing]}>Session not found</Text>
        <Pressable onPress={() => router.replace('/')} style={styles.homeButton}>
          <Text style={styles.homeButtonText}>Return home</Text>
        </Pressable>
      </View>
    )
  }

  return (
    <View style={styles.flex}>
      <View style={[styles.stickyHeader, { paddingTop: insets.top + 16 }]}>
        <View style={styles.stickyHeaderRow}>
          <View style={styles.flex1}>
            <Text style={styles.sessionTitle}>{session.name}</Text>
            {session.route ? <Text style={styles.mutedText}>{session.route}</Text> : null}
            {locationStatus === 'denied' && (
              <Text style={styles.deniedText}>Location access denied - live tracking is off</Text>
            )}
          </View>
          <View style={styles.timerBlock}>
            <Text style={styles.timerText}>{formatTime(elapsedTime)}</Text>
            <Text style={styles.timerLabel}>Elapsed</Text>
          </View>
        </View>
        <View style={styles.statusRow}>
          <StatusBadge status={session.status} />
          {isRerouting ? (
            <View style={styles.offRouteBadge}>
              <ActivityIndicator size="small" color={colors.alertCoral} />
              <Text style={styles.offRouteBadgeText}>Recalculating route...</Text>
            </View>
          ) : (
            session.route_deviation && (
              <View style={styles.offRouteBadge}>
                <AlertCircle size={12} color={colors.alertCoral} />
                <Text style={styles.offRouteBadgeText}>Off route</Text>
              </View>
            )
          )}
        </View>
        {rerouteError && <Text style={styles.deniedText}>{rerouteError}</Text>}
        {session.route_total_meters ? (
          <View style={styles.routeProgressBlock}>
            <View style={styles.routeProgressLabelRow}>
              <Text style={styles.routeProgressLabel}>Route progress</Text>
              <Text style={styles.routeProgressLabel}>
                {Math.round(
                  (Math.min(session.progress_meters, session.route_total_meters) /
                    session.route_total_meters) *
                    100
                )}
                %
              </Text>
            </View>
            <View style={styles.routeProgressTrack}>
              <View
                style={[
                  styles.routeProgressFill,
                  {
                    width: `${Math.min(100, (session.progress_meters / session.route_total_meters) * 100)}%`,
                  },
                ]}
              />
            </View>
          </View>
        ) : null}
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.mapBox}>
          {liveMapUrl && lastSent ? (
            <>
              <WebView source={{ uri: liveMapUrl }} style={StyleSheet.absoluteFillObject} />
              <View style={styles.liveBadge}>
                <BeaconDot size="sm" variant="pulse" />
                <Text style={styles.liveBadgeText}>Live</Text>
              </View>
              <View style={styles.coordsBar}>
                <Text style={styles.coordsText} numberOfLines={1}>
                  {lastSent.lat.toFixed(6)}, {lastSent.lng.toFixed(6)}
                </Text>
                <Pressable
                  onPress={() =>
                    Linking.openURL(
                      `https://www.openstreetmap.org/?mlat=${lastSent.lat}&mlon=${lastSent.lng}#map=17/${lastSent.lat}/${lastSent.lng}`
                    )
                  }
                  hitSlop={8}
                >
                  <ExternalLink size={18} color={colors.beaconAmber} />
                </Pressable>
              </View>
            </>
          ) : (
            <View style={styles.mapPlaceholder}>
              {locationStatus === 'denied' || locationStatus === 'error' ? (
                <AlertCircle size={36} color={colors.alertCoral} />
              ) : (
                <BeaconDot size="lg" variant="pulse" />
              )}
              <Text style={styles.mapPlaceholderText}>
                {locationStatus === 'denied'
                  ? 'Location permission is blocked'
                  : locationStatus === 'error'
                    ? 'Unable to update your location'
                    : isActive
                      ? 'Waiting for your location...'
                      : 'Location tracking has stopped'}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Checkpoints</Text>
          <View style={styles.checkpointList}>
            {checkpoints.map((checkpoint, idx) => (
              <View
                key={checkpoint.id}
                style={[
                  styles.checkpointCard,
                  idx === currentCheckpointIndex && styles.checkpointCardCurrent,
                  checkpoint.status === 'reached' && styles.checkpointCardReached,
                  (checkpoint.status === 'overdue' || checkpoint.status === 'pinged') &&
                    styles.checkpointCardAlert,
                ]}
              >
                <View style={styles.checkpointIcon}>
                  {checkpoint.status === 'reached' ? (
                    <CheckCircle2 size={24} color={colors.safeTeal} />
                  ) : checkpoint.status === 'overdue' || checkpoint.status === 'pinged' ? (
                    <AlertCircle size={24} color={colors.alertCoral} />
                  ) : idx === currentCheckpointIndex ? (
                    <BeaconDot size="md" variant="pulse" />
                  ) : (
                    <Clock size={24} color={colors.mutedForeground} />
                  )}
                </View>
                <View style={styles.flex1}>
                  <Text style={styles.checkpointName}>{checkpoint.name}</Text>
                  {checkpoint.lat !== null && checkpoint.lng !== null && (
                    <View style={styles.checkpointCoordsRow}>
                      <MapPin size={16} color={colors.mutedForeground} />
                      <Text style={styles.checkpointCoords}>
                        {checkpoint.lat.toFixed(4)}, {checkpoint.lng.toFixed(4)}
                      </Text>
                    </View>
                  )}
                </View>
                <StatusBadge status={checkpoint.status} />
              </View>
            ))}
          </View>
        </View>

        {checkpoints.length > 0 && checkpoints.every((checkpoint) => checkpoint.status === 'reached') && (
          <View style={styles.completeCard}>
            <Text style={styles.completeTitle}>All checkpoints reached!</Text>
            <Text style={[styles.mutedText, styles.completeDescription]}>
              Great job! You&apos;re safe. Let your contacts know you&apos;ve arrived.
            </Text>
            <Pressable onPress={() => void handleCompleteSession()} style={styles.completeButton}>
              <Home size={20} color={colors.inkIndigo} />
              <Text style={styles.completeButtonText}>Complete session</Text>
            </Pressable>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Your trusted contacts</Text>
          <View style={styles.contactsGrid}>
            {contacts.map((contact) => (
              <View key={contact.id} style={styles.contactCard}>
                <Text style={styles.checkpointName}>{contact.name}</Text>
                <Text style={styles.mutedText}>{contact.relationship}</Text>
                <Text style={styles.contactPhone}>{contact.phone}</Text>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>

      <Modal visible={showCountdownModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <AlertCircle size={48} color={colors.alertCoral} style={styles.modalIcon} />
            <Text style={styles.modalTitle}>Are you OK?</Text>
            <Text style={[styles.mutedText, styles.modalDescription]}>
              You missed a checkpoint. Walk or update your location to confirm you&apos;re fine -
              otherwise we&apos;ll alert your contacts shortly.
            </Text>
            <Pressable
              onPress={() => void handleSOS()}
              disabled={isSendingSOS}
              style={[styles.sosModalButton, isSendingSOS && styles.disabled]}
            >
              {isSendingSOS ? (
                <ActivityIndicator size="small" color={colors.white} />
              ) : (
                <Zap size={20} color={colors.white} />
              )}
              <Text style={styles.sosModalButtonText}>
                {isSendingSOS ? 'Sending...' : 'Send help now'}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={showEscalationModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, styles.escalationModalCard]}>
            <AlertCircle size={48} color={colors.alertCoral} style={styles.modalIcon} />
            <Text style={[styles.modalTitle, styles.escalationModalTitle]}>
              Your contacts have been alerted
            </Text>
            <Text style={[styles.mutedText, styles.modalDescription]}>
              We emailed your trusted contacts with your last known location.
            </Text>
            <Pressable onPress={() => router.replace('/history')} style={styles.doneButton}>
              <Text style={styles.doneButtonText}>Done</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Pressing SOS used to give no confirmation beyond a small status-badge
          text change - easy to miss, which is exactly why it could feel like
          "nothing happened" even when the request succeeded. This modal is
          unmissable and stays up until the person dismisses it. */}
      <Modal visible={session.status === 'sos_triggered'} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, styles.escalationModalCard]}>
            <Zap size={48} color={colors.alertCoral} style={styles.modalIcon} />
            <Text style={[styles.modalTitle, styles.escalationModalTitle]}>SOS sent</Text>
            <Text style={[styles.mutedText, styles.modalDescription]}>
              Your trusted contacts have been emailed with your last known location. Live
              tracking is still on - stay where you are if it&apos;s safe to do so.
            </Text>
            <Pressable onPress={() => router.replace('/history')} style={styles.doneButton}>
              <Text style={styles.doneButtonText}>OK</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <SOSButton onTrigger={() => void handleSOS()} disabled={isSendingSOS} />
    </View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  flex1: { flex: 1 },
  centeredScreen: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background, padding: 24 },
  notFoundSpacing: { marginTop: 12, marginBottom: 16 },
  homeButton: { backgroundColor: colors.beaconAmber, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 10 },
  homeButtonText: { color: colors.inkIndigo, fontWeight: '700' },
  mutedText: { fontSize: 13, color: colors.mutedForeground },
  stickyHeader: {
    backgroundColor: colors.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 16,
  },
  stickyHeaderRow: { flexDirection: 'row', justifyContent: 'space-between' },
  sessionTitle: { fontSize: 20, fontWeight: '700', color: colors.foreground },
  deniedText: { fontSize: 11, color: colors.alertCoral, marginTop: 4 },
  timerBlock: { alignItems: 'flex-end' },
  timerText: { fontSize: 26, fontWeight: '700', color: colors.beaconAmber, fontVariant: ['tabular-nums'] },
  timerLabel: { fontSize: 11, color: colors.mutedForeground },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  offRouteBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255, 75, 92, 0.1)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  offRouteBadgeText: { fontSize: 11, fontWeight: '600', color: colors.alertCoral },
  routeProgressBlock: { marginTop: 16 },
  routeProgressLabelRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  routeProgressLabel: { fontSize: 11, color: colors.mutedForeground },
  routeProgressTrack: { height: 8, borderRadius: 4, backgroundColor: colors.muted, overflow: 'hidden' },
  routeProgressFill: { height: 8, borderRadius: 4, backgroundColor: colors.safeTeal },
  content: { padding: 16, paddingBottom: 96 },
  mapBox: {
    aspectRatio: 16 / 9,
    backgroundColor: colors.muted,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.border,
    overflow: 'hidden',
    marginBottom: 32,
  },
  liveBadge: {
    position: 'absolute',
    left: 12,
    top: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.95)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  liveBadgeText: { fontSize: 12, fontWeight: '600', color: colors.foreground },
  coordsBar: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    backgroundColor: 'rgba(255,255,255,0.95)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  coordsText: { flex: 1, fontSize: 12, color: colors.foreground },
  mapPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  mapPlaceholderText: { marginTop: 16, fontSize: 14, fontWeight: '500', color: colors.foreground, textAlign: 'center' },
  section: { marginBottom: 32 },
  sectionTitle: { fontSize: 17, fontWeight: '700', color: colors.foreground, marginBottom: 16 },
  checkpointList: { gap: 12 },
  checkpointCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  checkpointCardCurrent: { borderColor: colors.beaconAmber, backgroundColor: 'rgba(255, 182, 72, 0.05)' },
  checkpointCardReached: { borderColor: colors.safeTeal, backgroundColor: 'rgba(72, 209, 184, 0.05)' },
  checkpointCardAlert: { borderColor: colors.alertCoral, backgroundColor: 'rgba(255, 75, 92, 0.05)' },
  checkpointIcon: { marginTop: 2 },
  checkpointName: { fontSize: 15, fontWeight: '600', color: colors.foreground },
  checkpointCoordsRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  checkpointCoords: { fontSize: 12, color: colors.mutedForeground },
  completeCard: {
    marginBottom: 32,
    padding: 20,
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.safeTeal,
  },
  completeTitle: { fontSize: 16, fontWeight: '600', color: colors.foreground, marginBottom: 8 },
  completeDescription: { marginBottom: 16 },
  completeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.safeTeal,
    paddingVertical: 14,
    borderRadius: 10,
  },
  completeButtonText: { fontWeight: '700', color: colors.inkIndigo },
  contactsGrid: { gap: 12 },
  contactCard: { padding: 16, backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border },
  contactPhone: { fontSize: 12, color: colors.mutedForeground, marginTop: 8 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: colors.background,
    borderRadius: 12,
    padding: 32,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  escalationModalCard: { borderWidth: 2, borderColor: colors.alertCoral },
  modalIcon: { marginBottom: 24 },
  modalTitle: { fontSize: 22, fontWeight: '700', color: colors.foreground, marginBottom: 8, textAlign: 'center' },
  escalationModalTitle: { color: colors.alertCoral },
  modalDescription: { textAlign: 'center', marginBottom: 24 },
  sosModalButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    width: '100%',
    backgroundColor: colors.alertCoral,
    paddingVertical: 14,
    borderRadius: 10,
  },
  sosModalButtonText: { color: colors.white, fontWeight: '700' },
  disabled: { opacity: 0.6 },
  doneButton: {
    width: '100%',
    alignItems: 'center',
    backgroundColor: colors.beaconAmber,
    paddingVertical: 14,
    borderRadius: 10,
  },
  doneButtonText: { color: colors.inkIndigo, fontWeight: '700' },
})
