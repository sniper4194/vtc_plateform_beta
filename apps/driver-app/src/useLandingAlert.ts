import { Audio } from "expo-av";
import { useEffect, useRef } from "react";
import { api } from "./api";
import { newLandings, newOffers, Notice, OfferLite, offerToast } from "./landing";

const SOUNDS = { landing: require("../assets/sounds/atterrissage.mp3"), offer: require("../assets/sounds/nouvelle-course.mp3") };

/**
 * Joue un son (fonctions directes d'expo-av, pas de hook fourni par le module : voir CLAUDE.md).
 * Renvoie null si le son est parti, sinon le message d'erreur : le bouton « Tester le son » l'affiche au chauffeur.
 */
export async function playSound(which: keyof typeof SOUNDS): Promise<string | null> {
  try {
    await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
    const { sound } = await Audio.Sound.createAsync(SOUNDS[which], { shouldPlay: true });
    sound.setOnPlaybackStatusUpdate((s) => { if (s.isLoaded && s.didJustFinish) sound.unloadAsync().catch(() => {}); });
    return null;
  } catch (e: any) { return e?.message ?? String(e); }
}
const play = (which: keyof typeof SOUNDS) => { void playSound(which); }; // alertes automatiques : son facultatif, le message s'affiche quand même

/**
 * Sons de l'application chauffeur : nouvelle course proposée, et atterrissage du vol d'une mission.
 * Vérifie les messages et les offres toutes les 10 s tant que le chauffeur est connecté et l'application ouverte. Ne fonctionne pas application
 * fermée : il faudra pour cela les notifications push (point 2 de la feuille de route), qui pourront reprendre le même son.
 */
export function useLandingAlert(active: boolean, notify: (text: string, tone?: "ok" | "bad") => void) {
  const seen = useRef(new Set<string>());
  const seenOffers = useRef<Set<string> | null>(null); // null : premier passage, qui sert de référence
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
        if (fresh.length) { notifyRef.current(`✈ ${fresh[0].title}`, "ok"); await play("landing"); }
        // Nouvelles offres de course
        const offers = await api<OfferLite[]>("/driver/offers");
        if (stop) return;
        if (seenOffers.current === null) seenOffers.current = new Set(offers.map((o) => o.offerId));
        else {
          const added = newOffers(offers, seenOffers.current);
          for (const o of offers) seenOffers.current.add(o.offerId);
          if (added.length) { notifyRef.current(offerToast(added[0], added.length), "ok"); await play("offer"); }
        }
      } catch { /* hors ligne : on réessaie au tour suivant */ }
    }
    check();
    const t = setInterval(check, 10_000); // une offre peut expirer en 60 s : on vérifie assez souvent
    return () => { stop = true; clearInterval(t); };
  }, [active]);
}
