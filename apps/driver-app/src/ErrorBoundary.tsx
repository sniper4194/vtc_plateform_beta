import { Component, ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import { reportCrash } from "./crashReport";
import { c, font } from "./theme";
import { Btn, Card, Display } from "./ui";

/**
 * Filet de sécurité : si un écran plante au rendu, on affiche l'erreur au lieu d'un écran blanc, avec un bouton pour fermer.
 * Le texte de l'erreur permet de comprendre le problème à partir d'une simple capture d'écran.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; onClose?: () => void; label?: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.warn(`[${this.props.label ?? "app"}]`, error?.message); reportCrash(error, this.props.label, true); }
  render() {
    const e = this.state.error;
    if (!e) return this.props.children;
    return (
      <View style={{ flex: 1, backgroundColor: c.sky, padding: 20, justifyContent: "center" }}>
        <Card color={c.cream} style={{ gap: 10, maxHeight: "90%" }}>
          <Display size={26} color={c.ink} shadow={c.red}>Un problème est survenu</Display>
          <ScrollView style={{ maxHeight: 300 }}>
            <Text selectable style={{ fontFamily: font.slab, fontSize: 13, color: c.ink }}>{this.props.label ? `${this.props.label} : ` : ""}{String(e.message ?? e)}</Text>
            {e.stack ? <Text selectable style={{ fontSize: 10, color: c.muted, marginTop: 8 }}>{e.stack.split("\n").slice(0, 6).join("\n")}</Text> : null}
          </ScrollView>
          <Btn label="Fermer" onPress={() => { this.setState({ error: null }); this.props.onClose?.(); }} />
        </Card>
      </View>
    );
  }
}
