import { ReactNode, useEffect, useRef, useState } from "react";
import { Animated, Pressable, StyleProp, StyleSheet, Text, TextStyle, View, ViewStyle } from "react-native";
import { c, font } from "./theme";

/** Texte à ombre « imprimée » (décalée, sans flou). */
export function Display({ children, size = 32, color = c.cream, shadow = c.dblue, style, family = font.display, lines }: {
  children: ReactNode; size?: number; color?: string; shadow?: string | null; style?: StyleProp<TextStyle>; family?: string; lines?: number;
}) {
  return (
    <Text numberOfLines={lines} style={[{ fontFamily: family, fontSize: size, color, lineHeight: size * 1.1 },
      shadow ? { textShadowColor: shadow, textShadowOffset: { width: size * 0.06, height: size * 0.06 }, textShadowRadius: 0 } : null, style]}>
      {children}
    </Text>
  );
}
export const Slab = (p: Parameters<typeof Display>[0]) => <Display family={font.slab} {...p} />;
export const Cond = ({ children, size = 14, color = c.ink, style }: { children: ReactNode; size?: number; color?: string; style?: StyleProp<TextStyle> }) => (
  <Text style={[{ fontFamily: font.cond, fontSize: size, color, letterSpacing: 1.5, textTransform: "uppercase" }, style]}>{children}</Text>
);
export const Script = ({ children, size = 28, color = c.cream, style }: { children: ReactNode; size?: number; color?: string; style?: StyleProp<TextStyle> }) => (
  <Text style={[{ fontFamily: font.script, fontSize: size, color }, style]}>{children}</Text>
);

export function Card({ children, color = c.cream, shadow = c.ink, offset = 5, style, onPress }: {
  children: ReactNode; color?: string; shadow?: string; offset?: number; style?: StyleProp<ViewStyle>; onPress?: () => void;
}) {
  const body = (
    <View style={{ marginRight: offset, marginBottom: offset }}>
      <View style={{ position: "absolute", left: offset, top: offset, right: -offset, bottom: -offset, backgroundColor: shadow, borderRadius: 18 }} />
      <View style={[{ backgroundColor: color, borderRadius: 18, borderWidth: 2.5, borderColor: c.ink, padding: 16 }, style]}>{children}</View>
    </View>
  );
  return onPress ? <Pressable onPress={onPress}>{body}</Pressable> : body;
}

export function Sticker({ size, color, rot = 0, children, style }: { size: number; color: string; rot?: number; children?: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, borderWidth: 2.5, borderColor: c.ink,
      alignItems: "center", justifyContent: "center", transform: [{ rotate: `${rot}deg` }] }, style]}>
      {children}
    </View>
  );
}

export function Chip({ label, color = c.cream, text = c.ink }: { label: string; color?: string; text?: string }) {
  return (
    <View style={{ backgroundColor: color, borderWidth: 2, borderColor: c.ink, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 }}>
      <Cond size={13} color={text}>{label}</Cond>
    </View>
  );
}

/** Bouton « maintenir pour valider » : évite les validations accidentelles au volant. */
export function HoldButton({ label, hint = "Maintenir", onComplete, color = c.yel, fill = c.red, disabled, ms = 650 }: {
  label: string; hint?: string; onComplete: () => void; color?: string; fill?: string; disabled?: boolean; ms?: number;
}) {
  const p = useRef(new Animated.Value(0)).current;
  const done = useRef(false);
  const start = () => {
    if (disabled) return;
    done.current = false;
    Animated.timing(p, { toValue: 1, duration: ms, useNativeDriver: false }).start(({ finished }) => {
      if (finished && !done.current) { done.current = true; onComplete(); setTimeout(() => p.setValue(0), 300); }
    });
  };
  const stop = () => { if (!done.current) Animated.timing(p, { toValue: 0, duration: 180, useNativeDriver: false }).start(); };
  return (
    <Pressable onPressIn={start} onPressOut={stop} disabled={disabled} accessibilityRole="button" accessibilityLabel={`${hint} : ${label}`}>
      <View style={{ marginRight: 5, marginBottom: 5, opacity: disabled ? 0.45 : 1 }}>
        <View style={{ position: "absolute", left: 5, top: 5, right: -5, bottom: -5, backgroundColor: c.ink, borderRadius: 16 }} />
        <View style={{ backgroundColor: color, borderRadius: 16, borderWidth: 2.5, borderColor: c.ink, overflow: "hidden", paddingVertical: 13, alignItems: "center" }}>
          <Animated.View style={{ position: "absolute", left: 0, top: 0, bottom: 0, backgroundColor: fill, width: p.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }) }} />
          <Slab size={19} color={c.ink} shadow={null}>{label}</Slab>
          <Cond size={11} color={c.ink} style={{ opacity: 0.7 }}>{hint}</Cond>
        </View>
      </View>
    </Pressable>
  );
}

export function Btn({ label, onPress, color = c.cream, text = c.ink, disabled }: { label: string; onPress: () => void; color?: string; text?: string; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled}>
      <View style={{ marginRight: 4, marginBottom: 4, opacity: disabled ? 0.45 : 1 }}>
        <View style={{ position: "absolute", left: 4, top: 4, right: -4, bottom: -4, backgroundColor: c.ink, borderRadius: 14 }} />
        <View style={{ backgroundColor: color, borderRadius: 14, borderWidth: 2.5, borderColor: c.ink, paddingVertical: 11, paddingHorizontal: 16, alignItems: "center" }}>
          <Slab size={15} color={text} shadow={null}>{label}</Slab>
        </View>
      </View>
    </Pressable>
  );
}

/** Mèche : la barre rouge raccourcit jusqu'à la fin du sursis. */
export function Fuse({ fraction, label }: { fraction: number; label: string }) {
  return (
    <View style={{ gap: 4 }}>
      <View style={{ height: 14, borderRadius: 7, borderWidth: 2.5, borderColor: c.ink, backgroundColor: c.cream, overflow: "hidden" }}>
        <View style={{ width: `${fraction * 100}%`, height: "100%", backgroundColor: fraction < 0.25 ? c.red : c.yel }} />
      </View>
      <Cond size={13} color={c.ink}>{label}</Cond>
    </View>
  );
}

export function useToast() {
  const [msg, setMsg] = useState<{ text: string; tone: "ok" | "bad" } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const show = (text: string, tone: "ok" | "bad" = "bad") => {
    setMsg({ text, tone });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(null), 3200);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  const node = msg ? (
    <View pointerEvents="none" style={{ position: "absolute", top: 12, left: 16, right: 16, zIndex: 10 }}>
      <Card color={msg.tone === "ok" ? c.yel : c.red} style={{ paddingVertical: 10 }}>
        <Slab size={14} color={msg.tone === "ok" ? c.ink : c.cream} shadow={null}>{msg.text}</Slab>
      </Card>
    </View>
  ) : null;
  return { show, node };
}

export const screen = StyleSheet.create({ root: { flex: 1, backgroundColor: c.blue } });
