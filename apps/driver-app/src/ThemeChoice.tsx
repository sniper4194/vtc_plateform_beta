import { StatusBar } from "expo-status-bar";
import { Pressable, SafeAreaView, ScrollView, Text, View } from "react-native";
import type { ThemeStyle } from "./theme";

const styles = [
  { id: "original", label: "Original", background: "#8fd0f5", surface: "#f5eedd", ink: "#14172b", blue: "#1a66c2", yellow: "#f7b30a", weight: "800" },
  { id: "classic", label: "Classique", background: "#151827", surface: "#fdf7e8", ink: "#142239", blue: "#1552a0", yellow: "#f9ae00", weight: "700" },
] as const;

export function ThemeChoice({ selected, onSelect, onClose }: {
  selected: ThemeStyle | null;
  onSelect: (style: ThemeStyle) => void;
  onClose?: () => void;
}) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#151827" }}>
      <StatusBar style="light" backgroundColor="#151827" />
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 12 }}>
        <View style={{ backgroundColor: "#fdf7e8", borderRadius: 26, padding: 24, gap: 18 }}>
          <Text accessibilityRole="header" style={{ color: "#142239", fontSize: 26, fontWeight: "700" }}>Choisir un thème</Text>
          {styles.map((style) => (
            <Pressable key={style.id} accessibilityRole="button" accessibilityLabel={style.label} accessibilityState={{ selected: selected === style.id }}
              onPress={() => onSelect(style.id)}
              style={{ backgroundColor: style.background, borderRadius: 16, borderWidth: selected === style.id ? 3 : 1, borderColor: selected === style.id ? style.blue : "#a5a9b0", padding: 7 }}>
              <View style={{ backgroundColor: style.surface, borderRadius: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 14 }}>
                <Text style={{ fontSize: 18, color: style.ink, fontWeight: style.weight }}>{style.label}</Text>
                <View style={{ flexDirection: "row", gap: 7 }}>
                  <View style={{ backgroundColor: style.blue, width: 16, height: 16, borderRadius: 8 }} />
                  <View style={{ backgroundColor: style.yellow, width: 16, height: 16, borderRadius: 8 }} />
                </View>
              </View>
            </Pressable>
          ))}
          {onClose && (
            <Pressable onPress={onClose} accessibilityRole="button" style={{ alignSelf: "center", padding: 12 }}>
              <Text style={{ color: "#1552a0", fontWeight: "700" }}>Fermer</Text>
            </Pressable>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
