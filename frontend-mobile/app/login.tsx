// Ported from the web app's app/login/page.tsx. Same login/signup toggle and
// same useAuth().login/signup calls; form inputs become TextInput and the
// page is wrapped in a KeyboardAvoidingView so the keyboard doesn't cover the
// password field.
import { useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { LockKeyhole, ShieldCheck } from 'lucide-react-native'
import { useAuth } from '@/lib/auth-context'
import { colors } from '@/lib/theme'

type Mode = 'login' | 'signup'

export default function LoginScreen() {
  const { login, signup } = useAuth()
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const changeMode = (nextMode: Mode) => {
    setMode(nextMode)
    setError(null)
  }

  const handleSubmit = async () => {
    setError(null)
    setSubmitting(true)
    try {
      if (mode === 'login') await login(email, password)
      else await signup(email, password)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to continue. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <View style={styles.iconCircle}>
            <ShieldCheck size={28} color={colors.inkIndigo} />
          </View>
          <Text style={styles.appName}>Raahi</Text>
          <Text style={styles.tagline}>Your safety circle, wherever you go.</Text>
        </View>

        <View style={styles.card}>
          <View style={styles.modeSwitch} accessibilityRole="tablist">
            {(['login', 'signup'] as const).map((item) => (
              <Pressable
                key={item}
                onPress={() => changeMode(item)}
                style={[styles.modeButton, mode === item && styles.modeButtonActive]}
              >
                <Text style={[styles.modeButtonText, mode === item && styles.modeButtonTextActive]}>
                  {item === 'login' ? 'Sign in' : 'Create account'}
                </Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              placeholder="you@example.com"
              placeholderTextColor={colors.mutedForeground}
              style={styles.input}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Password</Text>
            <View style={styles.passwordWrapper}>
              <LockKeyhole size={18} color={colors.mutedForeground} style={styles.passwordIcon} />
              <TextInput
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                placeholder="At least 8 characters"
                placeholderTextColor={colors.mutedForeground}
                style={[styles.input, styles.passwordInput]}
              />
            </View>
          </View>

          {error && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <Pressable
            onPress={() => void handleSubmit()}
            disabled={submitting || !email || password.length < 8}
            style={[styles.submitButton, (submitting || !email || password.length < 8) && styles.submitButtonDisabled]}
          >
            {submitting && <ActivityIndicator size="small" color={colors.inkIndigo} />}
            <Text style={styles.submitButtonText}>
              {mode === 'login' ? 'Sign in' : 'Create account'}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.dawnMist },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 40,
  },
  header: { alignItems: 'center', marginBottom: 32 },
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.beaconAmber,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  appName: { fontSize: 28, fontWeight: '700', color: colors.foreground },
  tagline: { marginTop: 8, color: colors.mutedForeground, textAlign: 'center' },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    padding: 24,
    gap: 20,
  },
  modeSwitch: {
    flexDirection: 'row',
    backgroundColor: colors.muted,
    borderRadius: 12,
    padding: 4,
  },
  modeButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  modeButtonActive: {
    backgroundColor: colors.background,
  },
  modeButtonText: { fontSize: 14, fontWeight: '600', color: colors.mutedForeground },
  modeButtonTextActive: { color: colors.foreground },
  field: { gap: 8 },
  label: { fontSize: 14, fontWeight: '500', color: colors.foreground },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.input,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    color: colors.foreground,
  },
  passwordWrapper: { justifyContent: 'center' },
  passwordIcon: { position: 'absolute', left: 12, zIndex: 1 },
  passwordInput: { paddingLeft: 40 },
  errorBox: {
    borderWidth: 1,
    borderColor: 'rgba(255, 75, 92, 0.3)',
    backgroundColor: 'rgba(255, 75, 92, 0.1)',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  errorText: { color: colors.alertCoral, fontSize: 14 },
  submitButton: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.beaconAmber,
    borderRadius: 12,
    paddingVertical: 14,
  },
  submitButtonDisabled: { opacity: 0.6 },
  submitButtonText: { fontSize: 15, fontWeight: '700', color: colors.inkIndigo },
})
