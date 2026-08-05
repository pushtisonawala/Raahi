// Ported from the web app's components/auth-gate.tsx. Next.js's
// usePathname/useRouter become expo-router's useSegments/useRouter, but the
// redirect rule is identical: bounce signed-out users to /login, and bounce
// signed-in users away from /login.
import { useEffect } from 'react'
import { ActivityIndicator, View } from 'react-native'
import { useRouter, useSegments } from 'expo-router'
import { useAuth } from '@/lib/auth-context'
import { colors } from '@/lib/theme'

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { token, loading } = useAuth()
  const segments = useSegments()
  const router = useRouter()
  const isLoginRoute = segments[0] === 'login'

  const shouldRedirectToLogin = !loading && !token && !isLoginRoute
  const shouldRedirectHome = !loading && !!token && isLoginRoute

  useEffect(() => {
    if (shouldRedirectToLogin) router.replace('/login')
    else if (shouldRedirectHome) router.replace('/')
  }, [shouldRedirectToLogin, shouldRedirectHome, router])

  if (loading || shouldRedirectToLogin || shouldRedirectHome) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator size="large" color={colors.beaconAmber} />
      </View>
    )
  }

  return <>{children}</>
}
