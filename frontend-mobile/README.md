# Raahi (React Native / Expo)

This is the React Native port of the `frontend/` Next.js web app. It talks to
the **same backend**, unchanged — same REST endpoints (`/login`, `/signup`,
`/contacts`, `/sessions`, etc.) and the same session WebSocket. Only the UI
layer was rewritten for mobile.

The original `frontend/` folder was left untouched; this lives alongside it
in `frontend-mobile/`.

## What changed vs. the web app, and why

| Web (Next.js)                          | Mobile (Expo)                                  | Why |
|-----------------------------------------|-------------------------------------------------|-----|
| Next.js App Router (`app/*/page.tsx`)   | Expo Router (`app/*.tsx`, file-based routing)   | Same file-based routing model on native |
| `<Header>` with nav links               | Bottom tab bar + `<TopBar>` (title + sign out)  | Tab bars are the standard mobile nav pattern |
| `localStorage` for the auth token       | `expo-secure-store`                             | Encrypted keychain/keystore storage on device |
| `localStorage` for settings             | `@react-native-async-storage/async-storage`     | Standard non-sensitive local storage on native |
| `navigator.geolocation.watchPosition`   | `expo-location`                                 | Native geolocation + permissions API |
| `<canvas>` beacon animation             | `Animated` + Views                              | No canvas on native |
| SVG hold-to-confirm SOS ring            | `react-native-svg` + `Animated`                 | Same visual technique, native-compatible |
| Drag-and-drop checkpoint reorder        | Up/down move buttons                            | Reliable on touch without an extra native DnD dependency |
| `<iframe>` OpenStreetMap embed          | `react-native-webview` loading the same embed URL | No iframes on native; WebView is the direct equivalent |
| Tailwind / shadcn (`app/globals.css`)   | `StyleSheet` + `lib/theme.ts`                   | Same color tokens (Beacon Path palette), no extra styling toolchain to configure |

Every hook and API call (`lib/api.ts`, `lib/hooks.ts`, `lib/hooks/useSessionData.ts`,
`lib/route.ts`, `lib/auth-context.tsx`) is the same logic as the web app's
`lib/` files — same endpoints, same request/response shapes, same error
handling. Nothing on your backend needs to change.

## Setup

This project's `node_modules` were **not** installed for you (the sandbox
this was built in had no disk space to run installs) — you'll need to do
that yourself:

```bash
cd frontend-mobile
npm install
npx expo install --fix   # reconciles exact package versions for your Expo SDK
```

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

- `EXPO_PUBLIC_API_URL` — same backend the web app used. Note that
  "localhost" means something different on a phone/emulator than on your
  laptop:
  - Android emulator: `http://10.0.2.2:8080`
  - iOS simulator: `http://localhost:8080` works
  - Physical device: use your computer's LAN IP, e.g. `http://192.168.1.20:8080`
- `EXPO_PUBLIC_GEOAPIFY_API_KEY` — same key the web app's place autocomplete used.

## Running it

```bash
npx expo start
```

Then press `i` for iOS simulator, `a` for Android emulator, or scan the QR
code with the Expo Go app on your phone.

## Notes

- Location permission strings are pre-filled in `app.json` (`ios.infoPlist`,
  `android.permissions`, and the `expo-location` plugin config) so live
  tracking works without extra native config.
- The auth token is stored with `expo-secure-store`, so signing out/in per
  device is independent from the web app's `localStorage` session.
- If you'd rather have a persistent live map than a WebView-based OSM embed
  (e.g. `react-native-maps` with a proper native map view), that's a
  reasonable follow-up — the WebView approach here was chosen to mirror the
  web app's `<iframe>` exactly with no new native map SDK to configure.
