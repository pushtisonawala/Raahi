// Ported from the web app's components/sos-button.tsx. Same interaction:
// press and hold for 1.5s to trigger. The web version used mouse/touch events
// and an SVG stroke-dasharray fill; here Pressable's onPressIn/onPressOut
// drives an Animated value that feeds an animated react-native-svg Circle's
// strokeDashoffset, producing the same radial fill ring.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Animated, Pressable, StyleSheet, View } from 'react-native'
import Svg, { Circle } from 'react-native-svg'
import { AlertCircle } from 'lucide-react-native'
import { colors } from '@/lib/theme'

const AnimatedCircle = Animated.createAnimatedComponent(Circle)
const CIRCUMFERENCE = 188.4
const HOLD_DURATION = 1500

type SOSButtonProps = {
  onTrigger?: () => void
  disabled?: boolean
}

export function SOSButton({ onTrigger, disabled = false }: SOSButtonProps) {
  const [isPressed, setIsPressed] = useState(false)
  const progress = useRef(new Animated.Value(0)).current
  const animationRef = useRef<Animated.CompositeAnimation | null>(null)

  useEffect(() => {
    return () => animationRef.current?.stop()
  }, [])

  const cancelPress = useCallback(() => {
    animationRef.current?.stop()
    progress.setValue(0)
    setIsPressed(false)
  }, [progress])

  const handlePressIn = useCallback(() => {
    if (disabled) return
    setIsPressed(true)
    progress.setValue(0)
    animationRef.current = Animated.timing(progress, {
      toValue: 1,
      duration: HOLD_DURATION,
      useNativeDriver: false,
    })
    animationRef.current.start(({ finished }) => {
      if (finished) {
        setIsPressed(false)
        progress.setValue(0)
        onTrigger?.()
      }
    })
  }, [disabled, onTrigger, progress])

  const strokeDashoffset = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [CIRCUMFERENCE, 0],
  })

  return (
    <Pressable
      onPressIn={handlePressIn}
      onPressOut={cancelPress}
      disabled={disabled}
      style={styles.wrapper}
      accessibilityRole="button"
      accessibilityLabel="Send SOS signal"
      accessibilityHint="Press and hold for a second and a half to alert your trusted contacts"
    >
      <View style={styles.buttonSize}>
        <Svg width={64} height={64} viewBox="0 0 64 64" style={StyleSheet.absoluteFillObject}>
          <Circle cx={32} cy={32} r={30} fill="none" stroke="rgba(255, 75, 92, 0.2)" strokeWidth={2} />
          <AnimatedCircle
            cx={32}
            cy={32}
            r={30}
            fill="none"
            stroke={colors.alertCoral}
            strokeWidth={2}
            strokeDasharray={`${CIRCUMFERENCE} ${CIRCUMFERENCE}`}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
          />
        </Svg>
        <View
          style={[
            styles.innerButton,
            { backgroundColor: disabled ? colors.muted : colors.alertCoral },
            isPressed && styles.innerButtonPressed,
          ]}
        >
          <AlertCircle size={28} color={disabled ? colors.mutedForeground : colors.white} />
        </View>
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    zIndex: 50,
  },
  buttonSize: {
    width: 64,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  innerButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  innerButtonPressed: {
    transform: [{ scale: 0.9 }],
  },
})
