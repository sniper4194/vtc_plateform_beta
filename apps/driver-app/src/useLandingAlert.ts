import { Audio } from "expo-av";
import { useEffect, useRef } from "react";
import { api } from "./api";
import { newLandings, Notice } from "./landing";

/** Joue le son d'atterrissage (fonctions directes d'expo-av, pas de hook fourni par le module : voir CLAUDE.md). */
async function playLanding() {
  try {
    await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
    const { sound } = await Audio.Sound.createAsync(require("../assets/sounds/atterrissage.mp3"), { shouldPlay: true });
    sound.setOnPlaybackStatusUpdate((s) => { if (s.isLoaded && s.didJustFinish) sound.unloadAsync().catch(() => {}); });
  } catch { /* son facultatif : le message s'affiche quand même */ }
}

/**
 * Vérifie les messages toutes les 15 s tant que le chauffeur est connecté et l'application ouverte. Ne fonctionne pas application
 * fermée : il faudra pour cela les notifications push (point 2 de la feuille de route), qui pourront reprendre le même son.
 */
export function useLandingAlert(active: boolean, notify: (text: string, tone?: "ok" | "bad") => void) {
  const seen = useRef(new Set<string>());
  const startedAt = useRef(Date.now());
  // La fonction d'affichage change à chaque rendu : on la garde dans une référence pour ne pas relancer la vérification en boucle.
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  useEffect(() => {
    if (!active) return;
    let stop = false;
    async function check() {
      try {
        const r = await api<{ items: Notice[] }>("/driver/notifications");
        if (stop) return;
        const fresh = newLandings(r.items ?? [], seen.current, startedAt.current);
        for (const n of r.items ?? []) seen.current.add(n.id);
        if (fresh.length) { notifyRef.current(`✈ ${fresh[0].title}`, "ok"); await playLanding(); }
      } catch { /* hors ligne : on réessaie au tour suivant */ }
    }
    check();
    const t = setInterval(check, 15_000);
    return () => { stop = true; clearInterval(t); };
  }, [active]);
}
