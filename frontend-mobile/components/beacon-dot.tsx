// Ported from the web app's components/beacon-dot.tsx. The web version drew
// an animated glow + dot on a <canvas>; React Native has no canvas, so this
// uses the Animated API for the pulsing ring and plain Views for the dot and
// highlight, producing the same visual (amber dot, soft outer glow pulse).
import { useEffect, useRef } from 'react'
import { Animated, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { colors } from '@/lib/theme'

type BeaconDotProps = {
  size?: 'sm' | 'md' | 'lg'
  variant?: 'pulse' | 'glow' | 'static'
  style?: StyleProp<ViewStyle>
}

const sizeMap = { sm: 12, md: 20, lg: 32 }

export function BeaconDot({ size = 'md', variant = 'pulse', style }: BeaconDotProps) {
  const pulse = useRef(new Animated.Value(0)).current
  const dimension = sizeMap[size]

  useEffect(() => {
    if (variant === 'static') return undefined

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1000, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1000, useNativeDriver: true }),
      ])
    )
    loop.start()
    return () => loop.stop()
  }, [pulse, variant])

  const ringScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.4] })
  const ringOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0] })

  return (
    <View style={[{ width: dimension, height: dimension }, styles.container, style]}>
      {variant !== 'static' && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.ring,
            {
              width: dimension,
              height: dimension,
              borderRadius: dimension / 2,
              borderColor: colors.beaconAmber,
              transform: [{ scale: ringScale }],
              opacity: ringOpacity,
            },
          ]}
        />
      )}
      <View
        style={[
          styles.dot,
          {
            width: dimension,
            height: dimension,
            borderRadius: dimension / 2,
            backgroundColor: colors.beaconAmber,
          },
        ]}
      >
        <View
          style={[
            styles.highlight,
            {
              width: dimension / 3,
              height: dimension / 3,
              borderRadius: dimension / 6,
              top: dimension / 6,
              left: dimension / 6,
            },
          ]}
        />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    borderWidth: 1,
  },
  dot: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  highlight: {
    position: 'absolute',
    backgroundColor: 'rgba(255, 255, 255, 0.4)',
  },
})
