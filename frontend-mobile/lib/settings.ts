// Replaces the web app's direct localStorage.getItem/setItem('raahi_settings', ...)
// calls with AsyncStorage, the standard non-sensitive local key/value store on
// React Native. Settings (grace period, live share) aren't secrets, so
// AsyncStorage (vs. SecureStore, used for the auth token) is the right fit.
import AsyncStorage from '@react-native-async-storage/async-storage'

const SETTINGS_KEY = 'raahi_settings'

export type RaahiSettings = {
  gracePeriod: number
  liveShare: boolean
}

const defaults: RaahiSettings = { gracePeriod: 5, liveShare: false }

export async function loadSettings(): Promise<RaahiSettings> {
  try {
    const stored = await AsyncStorage.getItem(SETTINGS_KEY)
    if (!stored) return defaults
    const parsed = JSON.parse(stored) as Partial<RaahiSettings>
    return {
      gracePeriod: parsed.gracePeriod ?? defaults.gracePeriod,
      liveShare: parsed.liveShare ?? defaults.liveShare,
    }
  } catch {
    return defaults
  }
}

export async function saveSettings(settings: RaahiSettings): Promise<void> {
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
}
