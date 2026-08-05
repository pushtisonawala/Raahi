// Ported from the web app's app/settings/page.tsx. Same three settings
// (grace period, live share toggle, link to contacts) plus the About block;
// localStorage persistence becomes AsyncStorage via lib/settings.ts.
import { useEffect, useState } from 'react'
import { Link } from 'expo-router'
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native'
import { ArrowRight } from 'lucide-react-native'
import { loadSettings, saveSettings } from '@/lib/settings'
import { colors } from '@/lib/theme'

export default function SettingsScreen() {
  const [gracePeriod, setGracePeriod] = useState(5)
  const [liveShare, setLiveShare] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    void loadSettings().then((settings) => {
      setGracePeriod(settings.gracePeriod)
      setLiveShare(settings.liveShare)
      setMounted(true)
    })
  }, [])

  useEffect(() => {
    if (mounted) void saveSettings({ gracePeriod, liveShare })
  }, [gracePeriod, liveShare, mounted])

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
      <View style={styles.headerBlock}>
        <Text style={styles.title}>Settings</Text>
        <Text style={styles.subtitle}>Customize your safety experience</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Grace period</Text>
        <Text style={styles.cardDescription}>
          If you&apos;re late reaching a checkpoint, we&apos;ll wait this long before checking in
          with you. This gives you time to get back on track.
        </Text>
        <View style={styles.gracePeriodRow}>
          <View style={styles.flex1}>
            <Text style={styles.label}>Minutes</Text>
            <TextInput
              value={String(gracePeriod)}
              onChangeText={(text) => setGracePeriod(Math.max(1, parseInt(text, 10) || 1))}
              keyboardType="number-pad"
              style={styles.input}
            />
          </View>
          <Text style={styles.mutedText}>{gracePeriod === 1 ? 'minute' : 'minutes'}</Text>
        </View>
        <Text style={styles.plainLanguage}>
          Plain language: If you&apos;re {gracePeriod} minute{gracePeriod === 1 ? '' : 's'} late,
          we&apos;ll check on you before contacting anyone.
        </Text>
      </View>

      <View style={styles.card}>
        <View style={styles.liveShareRow}>
          <View style={styles.flex1}>
            <Text style={styles.cardTitle}>Live location sharing</Text>
            <Text style={styles.cardDescription}>
              Share your real-time location with trusted contacts during active sessions. They can
              follow your progress on a map.
            </Text>
          </View>
          <Switch
            value={liveShare}
            onValueChange={setLiveShare}
            trackColor={{ true: colors.safeTeal, false: colors.muted }}
            thumbColor={colors.white}
          />
        </View>
      </View>

      <Link href="/contacts" asChild>
        <Pressable style={[styles.card, styles.linkCard]}>
          <View>
            <Text style={styles.cardTitle}>Manage trusted contacts</Text>
            <Text style={styles.cardDescription}>Add, edit, or remove people you trust</Text>
          </View>
          <ArrowRight size={24} color={colors.beaconAmber} />
        </Pressable>
      </Link>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>About Raahi</Text>
        <View style={styles.aboutList}>
          <Text style={styles.mutedText}>
            <Text style={styles.aboutLabel}>Version: </Text>1.0.0
          </Text>
          <Text style={styles.mutedText}>
            <Text style={styles.aboutLabel}>Made with: </Text>Expo, React Native
          </Text>
          <Text style={styles.mutedText}>
            <Text style={styles.aboutLabel}>Design: </Text>Beacon Path design system
          </Text>
          <Text style={[styles.mutedText, styles.aboutParagraph]}>
            Raahi helps you stay safe by keeping you connected with people who care. Your safety is
            our priority.
          </Text>
        </View>
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  flex1: { flex: 1 },
  content: { paddingHorizontal: 16, paddingBottom: 48 },
  headerBlock: { paddingTop: 24, paddingBottom: 24 },
  title: { fontSize: 26, fontWeight: '700', color: colors.foreground },
  subtitle: { fontSize: 14, color: colors.mutedForeground, marginTop: 4 },
  card: {
    padding: 20,
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 20,
  },
  cardTitle: { fontSize: 16, fontWeight: '600', color: colors.foreground, marginBottom: 8 },
  cardDescription: { fontSize: 13, color: colors.mutedForeground, marginBottom: 8, lineHeight: 18 },
  gracePeriodRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 12, marginTop: 8 },
  label: { fontSize: 13, fontWeight: '500', color: colors.foreground, marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.input,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.foreground,
  },
  mutedText: { fontSize: 13, color: colors.mutedForeground },
  plainLanguage: { fontSize: 12, color: colors.mutedForeground, marginTop: 12, fontStyle: 'italic' },
  liveShareRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 16 },
  linkCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  aboutList: { gap: 10, marginTop: 4 },
  aboutLabel: { fontWeight: '700', color: colors.mutedForeground },
  aboutParagraph: { marginTop: 4 },
})
