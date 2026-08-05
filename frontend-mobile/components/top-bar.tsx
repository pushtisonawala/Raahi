// Replaces the web app's components/header.tsx. Page-to-page navigation is
// now handled by the bottom tab bar (see app/(tabs)/_layout.tsx), so this
// component only keeps the brand mark, screen title, and the sign-out action
// that the web Header exposed.
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { LogOut } from 'lucide-react-native'
import { useAuth } from '@/lib/auth-context'
import { colors } from '@/lib/theme'

export function TopBar({ title }: { title: string }) {
  const { logout } = useAuth()
  const insets = useSafeAreaInsets()

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.row}>
        <View style={styles.brand}>
          <View style={styles.logoDot} />
          <Text style={styles.title}>{title}</Text>
        </View>
        <Pressable
          onPress={logout}
          hitSlop={12}
          style={styles.logoutButton}
          accessibilityRole="button"
          accessibilityLabel="Sign out"
        >
          <LogOut size={20} color={colors.mutedForeground} />
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.background,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  row: {
    height: 56,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  logoDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.beaconAmber,
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.foreground,
  },
  logoutButton: {
    padding: 8,
    borderRadius: 8,
  },
})
