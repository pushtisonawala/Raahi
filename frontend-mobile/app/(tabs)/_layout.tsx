// Replaces the web app's components/header.tsx nav links (Dashboard,
// Contacts, History, Settings) with a native bottom tab bar - the standard
// mobile pattern for top-level navigation. Each tab keeps the same TopBar
// (title + sign-out) the web Header showed on every page.
import { Tabs } from 'expo-router'
import { Clock, Home, Settings as SettingsIcon, Users } from 'lucide-react-native'
import { TopBar } from '@/components/top-bar'
import { colors } from '@/lib/theme'

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.beaconAmber,
        tabBarInactiveTintColor: colors.mutedForeground,
        tabBarStyle: { borderTopColor: colors.border, backgroundColor: colors.background },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Dashboard',
          header: () => <TopBar title="Raahi" />,
          tabBarIcon: ({ color, size }) => <Home color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="contacts"
        options={{
          title: 'Contacts',
          header: () => <TopBar title="Contacts" />,
          tabBarIcon: ({ color, size }) => <Users color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'History',
          header: () => <TopBar title="History" />,
          tabBarIcon: ({ color, size }) => <Clock color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          header: () => <TopBar title="Settings" />,
          tabBarIcon: ({ color, size }) => <SettingsIcon color={color} size={size} />,
        }}
      />
    </Tabs>
  )
}
