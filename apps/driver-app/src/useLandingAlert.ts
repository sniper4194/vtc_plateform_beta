import { Audio } from "expo-av";
import { useEffect, useRef } from "react";
import { api } from "./api";
import { DriverAlertKind, postDriverNotification } from "./driverNotifications";
import { newLandings, newOffers, Notice, OfferLite, offerToast } from "./landing";

const SOUNDS = { landing: require("../assets/sounds/atterrissage.mp3"), offer: require("../assets/sounds/nouvelle-course.mp3") };

async function playInApp(which: DriverAlertKind) {
  try {
    await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
    const { sound } = await Audio.Sound.createAsync(SOUNDS[which], { shouldPlay: true });
    sound.setOnPlaybackStatusUpdate((status) => {
      if (status.isLoaded && status.didJustFinish) void sound.unloadAsync().catch(() => {});
    });
  } catch { /* la bulle reste visible si le son ne peut pas être joué */ }
}

async function announce(kind: DriverAlertKind, title: string, body: string) {
  if (!(await postDriverNotification(kind, title, body))) await playInApp(kind);
}

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
    let checking = false;
    async function check() {
      if (checking) return;
      checking = true;
      try {
        const r = await api<{ items: Notice[] }>("/driver/notifications");
        if (stop) return;
        const fresh = newLandings(r.items ?? [], seen.current, startedAt.current);
        for (const n of r.items ?? []) seen.current.add(n.id);
        if (fresh.length) {
          notifyRef.current(`✈ ${fresh[0].title}`, "ok");
          void announce("landing", "Vol arrivé", fresh[0].title);
        }
        // Nouvelles offres de course
        const offers = await api<OfferLite[]>("/driver/offers");
        if (stop) return;
        if (seenOffers.current === null) seenOffers.current = new Set(offers.map((o) => o.offerId));
        else {
          const added = newOffers(offers, seenOffers.current);
          for (const o of offers) seenOffers.current.add(o.offerId);
          if (added.length) {
            notifyRef.current(offerToast(added[0], added.length), "ok");
            void announce("offer", "Nouvelle course", added.length === 1
              ? "Une offre est disponible dans le Radar."
              : `${added.length} offres sont disponibles dans le Radar.`);
          }
        }
      } catch { /* hors ligne : on réessaie au tour suivant */ }
      finally { checking = false; }
    }
    check();
    const t = setInterval(check, 10_000); // une offre peut expirer en 60 s : on vérifie assez souvent
    return () => { stop = true; clearInterval(t); };
  }, [active]);
}
