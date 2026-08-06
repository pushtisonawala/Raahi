// Ported from the web app's components/place-autocomplete.tsx. Same debounced
// Geoapify lookup (lib/route.ts's searchPlaces, unchanged) behind a TextInput
// with a suggestion dropdown, using FlatList instead of a listbox <div>.
import { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { MapPin } from 'lucide-react-native'
import { searchPlaces, type GeocodedPlace } from '@/lib/route'
import { colors } from '@/lib/theme'

type PlaceAutocompleteProps = {
  label: string
  value: string
  placeholder: string
  onValueChange: (value: string) => void
  onSelect: (place: GeocodedPlace) => void
  // Biases suggestions toward this position (typically the user's current
  // location) instead of ranking purely on generic text relevance. See
  // lib/route.ts#searchPlaces for why this matters.
  near?: { lat: number; lng: number }
}

export function PlaceAutocomplete({
  label,
  value,
  placeholder,
  onValueChange,
  onSelect,
  near,
}: PlaceAutocompleteProps) {
  const requestIdRef = useRef(0)
  const [suggestions, setSuggestions] = useState<GeocodedPlace[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const query = value.trim()
    if (query.length < 3) {
      setSuggestions([])
      setLoading(false)
      return undefined
    }

    const requestId = ++requestIdRef.current
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      setLoading(true)
      try {
        const places = await searchPlaces(query, controller.signal, near)
        if (requestId !== requestIdRef.current) return
        setSuggestions(places)
        setOpen(true)
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return
        if (requestId === requestIdRef.current) setSuggestions([])
      } finally {
        if (requestId === requestIdRef.current) setLoading(false)
      }
    }, 350)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, near?.lat, near?.lng])

  const selectPlace = (place: GeocodedPlace) => {
    onSelect(place)
    setSuggestions([])
    setOpen(false)
  }

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.inputWrapper}>
        <MapPin size={16} color={colors.mutedForeground} style={styles.inputIcon} />
        <TextInput
          value={value}
          onChangeText={(text) => {
            onValueChange(text)
            setOpen(true)
          }}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={placeholder}
          placeholderTextColor={colors.mutedForeground}
          style={styles.input}
        />
        {loading && (
          <ActivityIndicator size="small" color={colors.mutedForeground} style={styles.spinner} />
        )}
      </View>

      {open && suggestions.length > 0 && (
        <View style={styles.dropdown}>
          <FlatList
            data={suggestions}
            keyExtractor={(item) => item.id}
            keyboardShouldPersistTaps="handled"
            style={styles.dropdownList}
            renderItem={({ item }) => (
              <Pressable style={styles.option} onPress={() => selectPlace(item)}>
                <MapPin size={16} color={colors.beaconAmber} />
                <Text style={styles.optionText} numberOfLines={2}>
                  {item.name}
                </Text>
              </Pressable>
            )}
          />
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
  },
  label: {
    fontSize: 12,
    color: colors.mutedForeground,
    marginBottom: 4,
  },
  inputWrapper: {
    position: 'relative',
    justifyContent: 'center',
  },
  inputIcon: {
    position: 'absolute',
    left: 12,
    zIndex: 1,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.input,
    borderRadius: 12,
    paddingVertical: 10,
    paddingLeft: 36,
    paddingRight: 36,
    fontSize: 14,
    color: colors.foreground,
  },
  spinner: {
    position: 'absolute',
    right: 12,
  },
  dropdown: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    marginTop: 4,
    maxHeight: 220,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    zIndex: 50,
    elevation: 6,
  },
  dropdownList: {
    borderRadius: 10,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  optionText: {
    flex: 1,
    fontSize: 14,
    color: colors.foreground,
  },
})
