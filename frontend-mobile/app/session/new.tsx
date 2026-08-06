// Ported from the web app's app/session/new/page.tsx. Same 5-step wizard,
// same apiFetch POST /sessions call, same place-autocomplete + OSRM
// checkpoint generation. Checkpoints are generated from the real route and
// stay in that physical order - they aren't manually addable or reorderable
// (see route.ts and the web page for why: order has to match
// distance-along-route, which is what the backend actually uses to mark a
// checkpoint reached).
import { useEffect, useState } from 'react'
import { useRouter } from 'expo-router'
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import * as Location from 'expo-location'
import { ArrowLeft, ArrowRight, X, Footprints, Car, CheckCircle2 } from 'lucide-react-native'
import { PlaceAutocomplete } from '@/components/place-autocomplete'
import { apiFetch } from '@/lib/api'
import { useAuth } from '@/lib/auth-context'
import { useContacts } from '@/lib/hooks'
import type { Checkpoint } from '@/lib/types'
import {
  getRouteCheckpoints,
  reverseGeocodePlaceName,
  type GeocodedPlace,
  type RoutePoint,
  type TravelMode,
} from '@/lib/route'
import { colors } from '@/lib/theme'

const TOTAL_STEPS = 5

export default function SessionNewScreen() {
  const router = useRouter()
  const { token } = useAuth()
  const { contacts } = useContacts()

  const [step, setStep] = useState(1)
  const [sessionName, setSessionName] = useState('')
  const [route, setRoute] = useState('')
  const [gracePeriod, setGracePeriod] = useState(5)
  const [selectedContacts, setSelectedContacts] = useState<string[]>([])
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([])
  const [travelMode, setTravelMode] = useState<TravelMode>('walking')
  const [routeStartPlace, setRouteStartPlace] = useState('')
  const [routeEndPlace, setRouteEndPlace] = useState('')
  const [selectedStartPlace, setSelectedStartPlace] = useState<GeocodedPlace | null>(null)
  const [selectedEndPlace, setSelectedEndPlace] = useState<GeocodedPlace | null>(null)
  const [isGeneratingCheckpoints, setIsGeneratingCheckpoints] = useState(false)
  const [routeError, setRouteError] = useState<string | null>(null)
  const [routeGeometry, setRouteGeometry] = useState<RoutePoint[]>([])
  const [routeConfirmation, setRouteConfirmation] = useState<{
    mode: TravelMode
    averageKmh: number
    totalMeters: number
    totalSeconds: number
    scheduledTotalSeconds: number
    trafficBufferApplied: boolean
  } | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  // The device's own position, used only to bias place search results
  // toward wherever the user actually is (see lib/route.ts#searchPlaces) -
  // not stored or sent anywhere else. Silently stays null if permission is
  // denied or unavailable; search just falls back to unbiased results.
  const [deviceLocation, setDeviceLocation] = useState<{ lat: number; lng: number } | null>(null)
  // A suggested Start place built from the device's own position, offered
  // rather than auto-filled - "fetch current location and ask if we have to
  // start from there" - so typing a different start still works normally.
  // Cleared once the user picks a start some other way, or dismisses it.
  const [currentLocationSuggestion, setCurrentLocationSuggestion] = useState<GeocodedPlace | null>(
    null
  )
  const [suggestionDismissed, setSuggestionDismissed] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { status } = await Location.requestForegroundPermissionsAsync()
      if (cancelled || status !== 'granted') return
      try {
        const position = await Location.getCurrentPositionAsync({})
        if (!cancelled) {
          setDeviceLocation({ lat: position.coords.latitude, lng: position.coords.longitude })
        }
      } catch {
        // Unavailable - place search just stays unbiased.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!deviceLocation) return
    let cancelled = false
    void reverseGeocodePlaceName(deviceLocation.lat, deviceLocation.lng).then((name) => {
      if (cancelled) return
      setCurrentLocationSuggestion({
        id: 'current-location',
        name: name ?? `${deviceLocation.lat.toFixed(5)}, ${deviceLocation.lng.toFixed(5)}`,
        lat: deviceLocation.lat,
        lng: deviceLocation.lng,
      })
    })
    return () => {
      cancelled = true
    }
  }, [deviceLocation])

  // Takes an explicit mode instead of reading the travelMode state directly,
  // so it can be called immediately from the mode-toggle buttons with the
  // *new* mode before React has re-rendered - otherwise tapping "Driving"
  // right after generating a walking route would still read the stale
  // "walking" value from the closure and silently regenerate the same route.
  const generateCheckpointsForMode = async (mode: TravelMode) => {
    if (!selectedStartPlace || !selectedEndPlace) {
      setRouteError('Choose a start and destination from the suggestions.')
      return
    }

    setIsGeneratingCheckpoints(true)
    setRouteError(null)
    setRouteConfirmation(null)

    try {
      const startPlace = selectedStartPlace
      const endPlace = selectedEndPlace
      const modeLabel = mode === 'driving' ? 'Drive' : 'Walk'
      setRoute(`${modeLabel}: ${startPlace.name} to ${endPlace.name}`)

      const {
        checkpoints: generated,
        geometry,
        averageKmh,
        totalMeters,
        totalSeconds,
        scheduledTotalSeconds,
        trafficBufferApplied,
      } = await getRouteCheckpoints(startPlace.lat, startPlace.lng, endPlace.lat, endPlace.lng, new Date(), mode)
      if (generated.length === 0) {
        setRouteError('No checkpoints were generated for that route.')
        return
      }

      setRouteGeometry(geometry)
      // Not just an assumption - this is what the routing API actually
      // confirmed it computed the timings for (checked against both its own
      // mode tag and the implied pace). Shown to the user so "walking" vs
      // "driving" is never a silent guess.
      setRouteConfirmation({ mode, averageKmh, totalMeters, totalSeconds, scheduledTotalSeconds, trafficBufferApplied })

      const generatedCheckpoints: Checkpoint[] = generated.map((checkpoint, index) => {
        const expectedMinutes = Math.max(
          1,
          Math.round((new Date(checkpoint.expected_time).getTime() - Date.now()) / 60000)
        )

        return {
          id: `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
          name: checkpoint.name,
          expectedTime: expectedMinutes,
          location: { lat: checkpoint.lat, lng: checkpoint.lng },
          status: 'pending',
        }
      })

      setCheckpoints(generatedCheckpoints)
    } catch (error) {
      setRouteError(error instanceof Error ? error.message : 'Failed to generate checkpoints.')
    } finally {
      setIsGeneratingCheckpoints(false)
    }
  }

  const handleGenerateCheckpoints = () => generateCheckpointsForMode(travelMode)

  // Switching Walking/Driving used to only clear the confirmation banner,
  // leaving the previously generated checkpoint list on screen untouched -
  // which looked exactly like a bug (both modes "showing the same result")
  // unless you remembered to tap "Generate checkpoints" again. Now the
  // toggle itself re-fetches immediately when a route is already set up.
  const handleModeChange = (mode: TravelMode) => {
    setTravelMode(mode)
    if (selectedStartPlace && selectedEndPlace) {
      void generateCheckpointsForMode(mode)
    } else {
      setCheckpoints([])
      setRouteConfirmation(null)
    }
  }

  const handleDeleteCheckpoint = (id: string) => {
    setCheckpoints(checkpoints.filter((c) => c.id !== id))
  }

  const handleToggleContact = (contactId: string) => {
    setSelectedContacts((prev) =>
      prev.includes(contactId) ? prev.filter((id) => id !== contactId) : [...prev, contactId]
    )
  }

  const handleSubmit = async () => {
    if (!sessionName || !route || checkpoints.length === 0 || selectedContacts.length === 0) {
      Alert.alert('Please complete all steps')
      return
    }

    setIsSubmitting(true)
    setSubmitError(null)
    try {
      const response = await apiFetch(
        '/sessions',
        {
          method: 'POST',
          body: JSON.stringify({
            name: sessionName,
            route,
            grace_period: gracePeriod,
            // Stored so the active-session screen can ask the routing API
            // for the same walking/driving profile again if it ever needs
            // to auto-reroute (see lib/route.ts and the active session
            // screen's handling of route_deviation).
            travel_mode: travelMode,
            checkpoints: checkpoints.map((checkpoint) => ({
              name: checkpoint.name,
              expected_time: new Date(Date.now() + checkpoint.expectedTime * 60_000).toISOString(),
              lat: checkpoint.location.lat,
              lng: checkpoint.location.lng,
              radius_meters: 75,
            })),
            // Lets the backend measure progress-along-route instead of
            // requiring an exact-radius hit on each checkpoint, so taking a
            // different street than this specific OSRM path doesn't cause
            // false "overdue" alerts. Empty if checkpoints were only added
            // manually (no route was ever generated).
            route_geometry: routeGeometry,
          }),
        },
        token
      )
      const created = (await response.json()) as { id: string }
      router.replace(`/session/active/${created.id}`)
    } catch (cause) {
      setSubmitError(cause instanceof Error ? cause.message : 'Unable to start the session.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const nextDisabled =
    (step === 1 && (!sessionName || !route)) ||
    (step === 2 && checkpoints.length === 0) ||
    (step === 4 && selectedContacts.length === 0)

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.progressBlock}>
        <View style={styles.progressRow}>
          <Text style={styles.title}>New session</Text>
          <Text style={styles.mutedText}>Step {step} of {TOTAL_STEPS}</Text>
        </View>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${(step / TOTAL_STEPS) * 100}%` }]} />
        </View>
      </View>

      {step === 1 && (
        <View style={styles.stepGap}>
          <View>
            <Text style={styles.label}>Session name</Text>
            <TextInput
              value={sessionName}
              onChangeText={setSessionName}
              placeholder="e.g., Downtown exploration, Morning jog"
              placeholderTextColor={colors.mutedForeground}
              style={styles.input}
            />
            <Text style={styles.hint}>Give your session a descriptive name</Text>
          </View>
          <View>
            <Text style={styles.label}>Route or area</Text>
            <TextInput
              value={route}
              onChangeText={setRoute}
              placeholder="e.g., Central Park loop, Beach walk"
              placeholderTextColor={colors.mutedForeground}
              style={styles.input}
            />
            <Text style={styles.hint}>Where will you be?</Text>
          </View>
        </View>
      )}

      {step === 2 && (
        <View style={styles.stepGap}>
          <Text style={styles.label}>Set your route</Text>
          <View style={styles.generateCard}>
            <Text style={styles.generateTitle}>How are you getting there?</Text>
            <View style={styles.modeRow}>
              <Pressable
                onPress={() => handleModeChange('walking')}
                style={[styles.modeButton, travelMode === 'walking' && styles.modeButtonActive]}
              >
                <Footprints size={16} color={travelMode === 'walking' ? colors.inkIndigo : colors.foreground} />
                <Text
                  style={[
                    styles.modeButtonText,
                    travelMode === 'walking' && styles.modeButtonTextActive,
                  ]}
                >
                  Walking
                </Text>
              </Pressable>
              <Pressable
                onPress={() => handleModeChange('driving')}
                style={[styles.modeButton, travelMode === 'driving' && styles.modeButtonActive]}
              >
                <Car size={16} color={travelMode === 'driving' ? colors.inkIndigo : colors.foreground} />
                <Text
                  style={[
                    styles.modeButtonText,
                    travelMode === 'driving' && styles.modeButtonTextActive,
                  ]}
                >
                  Driving
                </Text>
              </Pressable>
            </View>
            <Text style={styles.generateTitle}>Start and destination</Text>
            <Text style={styles.hint}>
              Enter simple place names or addresses. We&apos;ll look up the real {travelMode} route
              between them and generate checkpoints spaced along it automatically - more checkpoints for
              a longer route, fewer for a short one.
            </Text>
            {currentLocationSuggestion && !selectedStartPlace && !routeStartPlace && !suggestionDismissed && (
              <View style={styles.suggestionBanner}>
                <Text style={styles.suggestionText}>
                  Use your current location as the start?{' '}
                  <Text style={styles.suggestionPlaceName}>{currentLocationSuggestion.name}</Text>
                </Text>
                <View style={styles.suggestionActions}>
                  <Pressable
                    onPress={() => {
                      setRouteStartPlace(currentLocationSuggestion.name)
                      setSelectedStartPlace(currentLocationSuggestion)
                    }}
                    style={styles.suggestionUseButton}
                  >
                    <Text style={styles.suggestionUseButtonText}>Use this</Text>
                  </Pressable>
                  <Pressable onPress={() => setSuggestionDismissed(true)} hitSlop={8}>
                    <X size={14} color={colors.mutedForeground} />
                  </Pressable>
                </View>
              </View>
            )}
            <View style={styles.placeRow}>
              <PlaceAutocomplete
                label="Start place"
                value={routeStartPlace}
                onValueChange={(value) => {
                  setRouteStartPlace(value)
                  setSelectedStartPlace(null)
                }}
                onSelect={(place) => {
                  setRouteStartPlace(place.name)
                  setSelectedStartPlace(place)
                }}
                placeholder="Home, office, or an address"
                near={deviceLocation ?? undefined}
              />
              <PlaceAutocomplete
                label="Destination"
                value={routeEndPlace}
                onValueChange={(value) => {
                  setRouteEndPlace(value)
                  setSelectedEndPlace(null)
                }}
                onSelect={(place) => {
                  setRouteEndPlace(place.name)
                  setSelectedEndPlace(place)
                }}
                placeholder="Park, market, or destination"
                near={deviceLocation ?? undefined}
              />
            </View>
            <Pressable
              onPress={() => void handleGenerateCheckpoints()}
              disabled={isGeneratingCheckpoints}
              style={[styles.secondaryButton, isGeneratingCheckpoints && styles.disabled]}
            >
              <Text style={styles.secondaryButtonText}>
                {isGeneratingCheckpoints ? 'Generating...' : 'Generate checkpoints'}
              </Text>
            </Pressable>
            <Text style={styles.hint}>This replaces the current checkpoint list.</Text>
            {routeError && <Text style={styles.errorText}>{routeError}</Text>}
            {routeConfirmation && (
              <View style={styles.confirmationBlock}>
                <View style={styles.confirmationRow}>
                  <CheckCircle2 size={16} color={colors.safeTeal} />
                  <Text style={styles.confirmationText}>
                    Confirmed via routing API: {routeConfirmation.mode} pace, ~
                    {routeConfirmation.averageKmh.toFixed(1)} km/h over{' '}
                    {(routeConfirmation.totalMeters / 1000).toFixed(1)} km (raw ETA ~
                    {Math.round(routeConfirmation.totalSeconds / 60)} min)
                  </Text>
                </View>
                {routeConfirmation.trafficBufferApplied && (
                  <Text style={styles.hint}>
                    Driving ETAs from this routing service assume clear roads with no traffic. Checkpoint
                    times are padded to ~{Math.round(routeConfirmation.scheduledTotalSeconds / 60)} min
                    (+60%) so real traffic doesn&apos;t trigger a false overdue alert.
                  </Text>
                )}
              </View>
            )}
          </View>

          {checkpoints.length > 0 && (
            <View>
              <Text style={styles.hint}>
                Checkpoints, in route order. This order is set by your actual path, so it isn&apos;t
                editable - but you can remove ones you don&apos;t need.
              </Text>
              <View style={styles.checkpointList}>
                {checkpoints.map((checkpoint, index) => (
                  <View key={checkpoint.id} style={styles.checkpointRow}>
                    <View style={styles.checkpointIndex}>
                      <Text style={styles.checkpointIndexText}>{index + 1}</Text>
                    </View>
                    <View style={styles.flex1}>
                      <Text style={styles.checkpointName} numberOfLines={1}>
                        {checkpoint.name}
                      </Text>
                      <Text style={styles.hint}>{checkpoint.expectedTime} min</Text>
                    </View>
                    <Pressable onPress={() => handleDeleteCheckpoint(checkpoint.id)} hitSlop={6}>
                      <X size={16} color={colors.alertCoral} />
                    </Pressable>
                  </View>
                ))}
              </View>
            </View>
          )}
        </View>
      )}

      {step === 3 && (
        <View style={styles.stepGap}>
          <Text style={styles.label}>Grace period</Text>
          <View style={styles.gracePeriodRow}>
            <TextInput
              value={String(gracePeriod)}
              onChangeText={(text) => setGracePeriod(Math.max(1, parseInt(text, 10) || 1))}
              keyboardType="number-pad"
              style={[styles.input, styles.flex1]}
            />
            <Text style={styles.mutedText}>{gracePeriod === 1 ? 'minute' : 'minutes'}</Text>
          </View>
          <Text style={[styles.hint, styles.plainLanguageBox]}>
            Plain language: If you&apos;re {gracePeriod} minute{gracePeriod === 1 ? '' : 's'} late
            reaching a checkpoint, we&apos;ll check on you before contacting anyone. This gives you
            time to get back on track.
          </Text>
        </View>
      )}

      {step === 4 && (
        <View style={styles.stepGap}>
          <Text style={styles.label}>Who should we contact if needed?</Text>
          {contacts.length > 0 ? (
            <View style={styles.contactList}>
              {contacts.map((contact) => (
                <Pressable
                  key={contact.id}
                  onPress={() => handleToggleContact(contact.id)}
                  style={styles.contactRow}
                >
                  <View
                    style={[
                      styles.checkbox,
                      selectedContacts.includes(contact.id) && styles.checkboxChecked,
                    ]}
                  />
                  <View>
                    <Text style={styles.checkpointName}>{contact.name}</Text>
                    <Text style={styles.mutedText}>{contact.relationship}</Text>
                  </View>
                </Pressable>
              ))}
            </View>
          ) : (
            <View style={styles.emptyBox}>
              <Text style={styles.mutedText}>No trusted contacts yet</Text>
            </View>
          )}
        </View>
      )}

      {step === 5 && (
        <View style={styles.reviewCard}>
          <View>
            <Text style={styles.reviewLabel}>Session name</Text>
            <Text style={styles.reviewValue}>{sessionName}</Text>
          </View>
          <View style={styles.reviewDivider}>
            <Text style={styles.reviewLabel}>Route</Text>
            <Text style={styles.reviewValue}>{route}</Text>
          </View>
          <View style={styles.reviewDivider}>
            <Text style={styles.reviewLabel}>Travel mode</Text>
            <Text style={styles.reviewValue}>{travelMode === 'driving' ? 'Driving' : 'Walking'}</Text>
          </View>
          <View style={styles.reviewDivider}>
            <Text style={styles.reviewLabel}>Checkpoints</Text>
            <Text style={styles.reviewValue}>{checkpoints.length} waypoints</Text>
          </View>
          <View style={styles.reviewDivider}>
            <Text style={styles.reviewLabel}>Grace period</Text>
            <Text style={styles.reviewValue}>{gracePeriod} minutes</Text>
          </View>
          <View style={styles.reviewDivider}>
            <Text style={styles.reviewLabel}>Contacts</Text>
            <Text style={styles.reviewValue}>
              {selectedContacts.length} {selectedContacts.length === 1 ? 'person' : 'people'} notified
            </Text>
          </View>
        </View>
      )}

      <View style={styles.navRow}>
        <Pressable
          onPress={() => setStep(Math.max(1, step - 1))}
          disabled={step === 1}
          style={[styles.backButton, step === 1 && styles.disabled]}
        >
          <ArrowLeft size={20} color={colors.foreground} />
          <Text style={styles.backButtonText}>Back</Text>
        </Pressable>

        {step < TOTAL_STEPS ? (
          <Pressable
            onPress={() => setStep(step + 1)}
            disabled={nextDisabled}
            style={[styles.nextButton, nextDisabled && styles.disabled]}
          >
            <Text style={styles.nextButtonText}>Next</Text>
            <ArrowRight size={20} color={colors.inkIndigo} />
          </Pressable>
        ) : (
          <View style={styles.startColumn}>
            {submitError && <Text style={styles.errorText}>{submitError}</Text>}
            <Pressable
              onPress={() => void handleSubmit()}
              disabled={isSubmitting}
              style={[styles.startButton, isSubmitting && styles.disabled]}
            >
              <Text style={styles.nextButtonText}>{isSubmitting ? 'Starting...' : 'Start session'}</Text>
              <ArrowRight size={20} color={colors.inkIndigo} />
            </Pressable>
          </View>
        )}
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  flex1: { flex: 1 },
  content: { padding: 16, paddingBottom: 48 },
  progressBlock: { marginBottom: 24 },
  progressRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  title: { fontSize: 22, fontWeight: '700', color: colors.foreground },
  mutedText: { fontSize: 13, color: colors.mutedForeground, fontWeight: '500' },
  progressTrack: { height: 8, borderRadius: 4, backgroundColor: colors.muted, overflow: 'hidden' },
  progressFill: { height: 8, borderRadius: 4, backgroundColor: colors.beaconAmber },
  stepGap: { gap: 16 },
  label: { fontSize: 14, fontWeight: '500', color: colors.foreground, marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.input,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.foreground,
  },
  hint: { fontSize: 12, color: colors.mutedForeground, marginTop: 8 },
  generateCard: {
    gap: 12,
    padding: 16,
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  generateTitle: { fontSize: 14, fontWeight: '500', color: colors.foreground },
  modeRow: { flexDirection: 'row', gap: 8 },
  modeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.input,
  },
  modeButtonActive: { backgroundColor: colors.beaconAmber, borderColor: colors.beaconAmber },
  modeButtonText: { fontSize: 13, fontWeight: '600', color: colors.foreground },
  modeButtonTextActive: { color: colors.inkIndigo },
  confirmationBlock: { gap: 4 },
  confirmationRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  confirmationText: { fontSize: 13, color: colors.safeTeal, flex: 1 },
  placeRow: { gap: 12 },
  suggestionBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 182, 72, 0.4)',
    backgroundColor: 'rgba(255, 182, 72, 0.08)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  suggestionText: { flex: 1, fontSize: 12, color: colors.foreground },
  suggestionPlaceName: { color: colors.mutedForeground },
  suggestionActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  suggestionUseButton: {
    backgroundColor: colors.beaconAmber,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  suggestionUseButtonText: { color: colors.inkIndigo, fontWeight: '700', fontSize: 12 },
  secondaryButton: {
    alignSelf: 'flex-start',
    backgroundColor: colors.beaconAmber,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  secondaryButtonText: { color: colors.inkIndigo, fontWeight: '600', fontSize: 13 },
  errorText: { color: colors.alertCoral, fontSize: 13 },
  checkpointList: { marginTop: 8, gap: 8 },
  checkpointRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    backgroundColor: colors.muted,
    borderRadius: 10,
  },
  checkpointIndex: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkpointIndexText: { fontSize: 12, fontWeight: '700', color: colors.mutedForeground },
  checkpointName: { fontSize: 14, fontWeight: '600', color: colors.foreground },
  gracePeriodRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  plainLanguageBox: { backgroundColor: colors.card, padding: 12, borderRadius: 10 },
  contactList: { gap: 10 },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.border,
  },
  checkboxChecked: { backgroundColor: colors.beaconAmber, borderColor: colors.beaconAmber },
  emptyBox: {
    alignItems: 'center',
    paddingVertical: 32,
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  reviewCard: {
    padding: 20,
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 12,
  },
  reviewDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: 12 },
  reviewLabel: { fontSize: 11, fontWeight: '600', color: colors.mutedForeground, textTransform: 'uppercase' },
  reviewValue: { fontSize: 16, color: colors.foreground, marginTop: 4, fontWeight: '600' },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginTop: 32,
    paddingTop: 24,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  backButtonText: { fontWeight: '700', color: colors.foreground },
  nextButton: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.beaconAmber,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 10,
  },
  nextButtonText: { fontWeight: '700', color: colors.inkIndigo },
  startColumn: { marginLeft: 'auto', alignItems: 'flex-end', gap: 8 },
  startButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.safeTeal,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 10,
  },
  disabled: { opacity: 0.5 },
})
