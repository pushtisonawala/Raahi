'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Header } from '@/components/header'
import { PlaceAutocomplete } from '@/components/place-autocomplete'
import { apiFetch } from '@/lib/api'
import { useAuth } from '@/lib/auth-context'
import { useContacts } from '@/lib/hooks'
import { ArrowRight, ArrowLeft, X, Footprints, Car, CheckCircle2 } from 'lucide-react'
import type { Checkpoint } from '@/lib/types'
import {
  getRouteCheckpoints,
  reverseGeocodePlaceName,
  type GeocodedPlace,
  type RoutePoint,
  type TravelMode,
} from '@/lib/route'

export default function SessionNewPage() {
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
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setDeviceLocation({ lat: position.coords.latitude, lng: position.coords.longitude })
      },
      () => {
        // Denied or unavailable - place search just stays unbiased.
      },
      { enableHighAccuracy: true, timeout: 8000 }
    )
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
  // *new* mode before React has re-rendered - otherwise clicking "Driving"
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
          location: {
            lat: checkpoint.lat,
            lng: checkpoint.lng,
          },
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
  // unless you remembered to press "Generate checkpoints" again. Now the
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
      alert('Please complete all steps')
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
            // page's handling of route_deviation).
            travel_mode: travelMode,
            checkpoints: checkpoints.map((checkpoint) => ({
              name: checkpoint.name,
              expected_time: new Date(
                Date.now() + checkpoint.expectedTime * 60_000
              ).toISOString(),
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
      router.push(`/session/active/${created.id}`)
    } catch (cause) {
      setSubmitError(cause instanceof Error ? cause.message : 'Unable to start the session.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <div className="max-w-2xl mx-auto px-4 py-12 sm:px-6 lg:px-8">
        {/* Progress Indicator */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-3xl font-bold text-foreground">New session</h1>
            <span className="text-sm font-medium text-muted-foreground">Step {step} of 5</span>
          </div>
          <div className="w-full bg-muted rounded-full h-2">
            <div
              className="h-2 bg-beacon-amber rounded-full transition-all duration-300"
              style={{ width: `${(step / 5) * 100}%` }}
            />
          </div>
        </div>

        {/* Step 1: Session Name */}
        {step === 1 && (
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Session name</label>
              <input
                type="text"
                value={sessionName}
                onChange={(e) => setSessionName(e.target.value)}
                placeholder="e.g., Downtown exploration, Morning jog"
                className="w-full px-4 py-3 bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-beacon-amber"
              />
              <p className="text-xs text-muted-foreground mt-2">Give your session a descriptive name</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Route or area</label>
              <input
                type="text"
                value={route}
                onChange={(e) => setRoute(e.target.value)}
                placeholder="e.g., Central Park loop, Beach walk"
                className="w-full px-4 py-3 bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-beacon-amber"
              />
              <p className="text-xs text-muted-foreground mt-2">Where will you be?</p>
            </div>
          </div>
        )}

        {/* Step 2: Checkpoints */}
        {step === 2 && (
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-foreground mb-4">Set your route</label>
              <div className="space-y-4 mb-6 p-4 bg-card rounded-lg border border-border">
                <div>
                  <p className="text-sm font-medium text-foreground mb-2">How are you getting there?</p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleModeChange('walking')}
                      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                        travelMode === 'walking'
                          ? 'bg-beacon-amber text-ink-indigo border-beacon-amber'
                          : 'bg-input text-foreground border-border hover:border-beacon-amber/50'
                      }`}
                    >
                      <Footprints size={16} />
                      Walking
                    </button>
                    <button
                      type="button"
                      onClick={() => handleModeChange('driving')}
                      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                        travelMode === 'driving'
                          ? 'bg-beacon-amber text-ink-indigo border-beacon-amber'
                          : 'bg-input text-foreground border-border hover:border-beacon-amber/50'
                      }`}
                    >
                      <Car size={16} />
                      Driving
                    </button>
                  </div>
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground mb-2">Start and destination</p>
                  <p className="text-xs text-muted-foreground mb-4">
                    Enter simple place names or addresses. We&apos;ll look up the real {travelMode} route
                    between them and generate checkpoints spaced along it automatically — more checkpoints
                    for a longer route, fewer for a short one.
                  </p>
                </div>
                {currentLocationSuggestion && !selectedStartPlace && !routeStartPlace && !suggestionDismissed && (
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-beacon-amber/40 bg-beacon-amber/5 px-3 py-2">
                    <p className="text-xs text-foreground">
                      Use your current location as the start?{' '}
                      <span className="text-muted-foreground">{currentLocationSuggestion.name}</span>
                    </p>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setRouteStartPlace(currentLocationSuggestion.name)
                          setSelectedStartPlace(currentLocationSuggestion)
                        }}
                        className="rounded-md bg-beacon-amber px-2 py-1 text-xs font-semibold text-ink-indigo hover:bg-amber-500"
                      >
                        Use this
                      </button>
                      <button
                        type="button"
                        onClick={() => setSuggestionDismissed(true)}
                        className="p-1 text-muted-foreground hover:text-foreground"
                        aria-label="Dismiss suggestion"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleGenerateCheckpoints}
                    disabled={isGeneratingCheckpoints}
                    className="px-4 py-2 bg-beacon-amber text-ink-indigo rounded-lg font-medium hover:bg-amber-500 transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isGeneratingCheckpoints ? 'Generating...' : 'Generate checkpoints'}
                  </button>
                  <span className="text-xs text-muted-foreground">This replaces the current checkpoint list.</span>
                </div>
                {routeError && <p className="text-sm text-alert-coral">{routeError}</p>}
                {routeConfirmation && (
                  <div className="space-y-1">
                    <p className="flex items-center gap-2 text-sm text-safe-teal">
                      <CheckCircle2 size={16} />
                      Confirmed via routing API: {routeConfirmation.mode} pace, ~
                      {routeConfirmation.averageKmh.toFixed(1)} km/h over{' '}
                      {(routeConfirmation.totalMeters / 1000).toFixed(1)} km
                      {' '}(raw ETA ~{Math.round(routeConfirmation.totalSeconds / 60)} min)
                    </p>
                    {routeConfirmation.trafficBufferApplied && (
                      <p className="text-xs text-muted-foreground">
                        Driving ETAs from this routing service assume clear roads with no traffic. Checkpoint
                        times are padded to ~{Math.round(routeConfirmation.scheduledTotalSeconds / 60)} min
                        (+60%) so real traffic doesn&apos;t trigger a false overdue alert.
                      </p>
                    )}
                  </div>
                )}
              </div>

              {checkpoints.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    Checkpoints, in route order. This order is set by your actual path, so it isn&apos;t
                    editable — but you can remove ones you don&apos;t need.
                  </p>
                  <div className="space-y-2">
                    {checkpoints.map((checkpoint, index) => (
                      <div
                        key={checkpoint.id}
                        className="flex items-center gap-3 p-3 bg-muted rounded-lg"
                      >
                        <div className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-card text-xs font-semibold text-muted-foreground">
                          {index + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm text-foreground truncate">{checkpoint.name}</p>
                          <p className="text-xs text-muted-foreground">{checkpoint.expectedTime} min</p>
                        </div>
                        <button
                          onClick={() => handleDeleteCheckpoint(checkpoint.id)}
                          className="p-2 hover:bg-alert-coral/10 text-alert-coral rounded-md transition-colors"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Step 3: Grace Period */}
        {step === 3 && (
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Grace period</label>
              <div className="flex items-end gap-4">
                <div className="flex-1">
                  <input
                    type="number"
                    min="1"
                    max="60"
                    value={gracePeriod}
                    onChange={(e) => setGracePeriod(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-full px-4 py-3 bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-beacon-amber"
                  />
                </div>
                <span className="text-sm text-muted-foreground pb-3">
                  {gracePeriod === 1 ? 'minute' : 'minutes'}
                </span>
              </div>
              <p className="text-sm text-muted-foreground mt-4 p-3 bg-card rounded-lg">
                <strong>Plain language:</strong> If you&apos;re {gracePeriod} minute{gracePeriod === 1 ? '' : 's'} late reaching a checkpoint, we&apos;ll check on you before contacting anyone. This gives you time to get back on track.
              </p>
            </div>
          </div>
        )}

        {/* Step 4: Select Contacts */}
        {step === 4 && (
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-foreground mb-4">
                Who should we contact if needed?
              </label>
              {contacts.length > 0 ? (
                <div className="space-y-3">
                  {contacts.map((contact) => (
                    <div
                      key={contact.id}
                      className="flex items-center gap-3 p-4 border border-border rounded-lg hover:border-beacon-amber/50 transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={selectedContacts.includes(contact.id)}
                        onChange={() => handleToggleContact(contact.id)}
                        className="w-5 h-5 accent-beacon-amber rounded cursor-pointer"
                      />
                      <div className="flex-1">
                        <p className="font-medium text-foreground">{contact.name}</p>
                        <p className="text-sm text-muted-foreground">{contact.relationship}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 bg-card rounded-lg border border-border">
                  <p className="text-muted-foreground mb-4">No trusted contacts yet</p>
                  <a href="/contacts" className="text-beacon-amber hover:underline font-semibold text-sm">
                    Add contacts first
                  </a>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Step 5: Review */}
        {step === 5 && (
          <div className="space-y-6">
            <div className="bg-card rounded-lg border border-border p-6 space-y-4">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase">Session name</p>
                <p className="text-lg font-semibold text-foreground mt-1">{sessionName}</p>
              </div>
              <div className="border-t border-border pt-4">
                <p className="text-xs font-medium text-muted-foreground uppercase">Route</p>
                <p className="text-foreground mt-1">{route}</p>
              </div>
              <div className="border-t border-border pt-4">
                <p className="text-xs font-medium text-muted-foreground uppercase">Travel mode</p>
                <p className="text-foreground mt-1 capitalize">{travelMode}</p>
              </div>
              <div className="border-t border-border pt-4">
                <p className="text-xs font-medium text-muted-foreground uppercase">Checkpoints</p>
                <p className="text-foreground mt-1">{checkpoints.length} waypoints</p>
              </div>
              <div className="border-t border-border pt-4">
                <p className="text-xs font-medium text-muted-foreground uppercase">Grace period</p>
                <p className="text-foreground mt-1">{gracePeriod} minutes</p>
              </div>
              <div className="border-t border-border pt-4">
                <p className="text-xs font-medium text-muted-foreground uppercase">Contacts</p>
                <p className="text-foreground mt-1">
                  {selectedContacts.length} {selectedContacts.length === 1 ? 'person' : 'people'} notified
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Navigation */}
        <div className="flex items-center gap-4 mt-8 pt-6 border-t border-border">
          <button
            onClick={() => setStep(Math.max(1, step - 1))}
            disabled={step === 1}
            className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg font-semibold hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ArrowLeft size={20} />
            Back
          </button>
          <div className="flex-1" />
          {step < 5 ? (
            <button
              onClick={() => setStep(step + 1)}
              disabled={
                (step === 1 && (!sessionName || !route)) ||
                (step === 2 && checkpoints.length === 0) ||
                (step === 4 && selectedContacts.length === 0)
              }
              className="flex items-center gap-2 px-6 py-2 bg-beacon-amber text-ink-indigo rounded-lg font-semibold hover:bg-amber-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
              <ArrowRight size={20} />
            </button>
          ) : (
            <div className="flex flex-col items-end gap-2">
              {submitError && <p className="text-sm text-alert-coral">{submitError}</p>}
              <button
                onClick={() => void handleSubmit()}
                disabled={isSubmitting}
                className="flex items-center gap-2 px-6 py-2 bg-safe-teal text-ink-indigo rounded-lg font-semibold hover:bg-teal-400 transition-colors disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting ? 'Starting...' : 'Start session'}
                <ArrowRight size={20} />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
