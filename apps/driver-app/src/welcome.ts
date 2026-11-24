/**
 * Carte de bienvenue traduite : quelques phrases que le chauffeur montre au voyageur étranger, dans sa langue.
 * Formulations neutres (aucun accord selon le genre du voyageur ou du chauffeur). Langues limitées à celles dont la traduction est sûre.
 */
export const WELCOME_LANGS = ["en", "es", "de", "it", "pt", "nl"] as const;
type Lang = (typeof WELCOME_LANGS)[number] | "fr";

const T: Record<Lang, { name: string; lines: (p: { name: string; minutes: number }) => string[] }> = {
  fr: { name: "Français", lines: ({ name, minutes }) => [`Bonjour ${name}, bienvenue !`, "Je vous accompagne aujourd'hui avec CliCab.", `Le trajet dure environ ${minutes} minutes.`, "Je m'occupe de vos bagages."] },
  en: { name: "English", lines: ({ name, minutes }) => [`Hello ${name}, welcome!`, "I'll be your CliCab driver today.", `The ride takes about ${minutes} minutes.`, "Let me take care of your luggage."] },
  es: { name: "Español", lines: ({ name, minutes }) => [`¡Hola, ${name}! Le damos la bienvenida.`, "Hoy viaja conmigo, con CliCab.", `El trayecto dura unos ${minutes} minutos.`, "Yo me encargo de su equipaje."] },
  de: { name: "Deutsch", lines: ({ name, minutes }) => [`Hallo ${name}, herzlich willkommen!`, "Ich fahre Sie heute mit CliCab.", `Die Fahrt dauert etwa ${minutes} Minuten.`, "Ich kümmere mich um Ihr Gepäck."] },
  it: { name: "Italiano", lines: ({ name, minutes }) => [`Buongiorno ${name}, le diamo il benvenuto!`, "Oggi viaggia con me, con CliCab.", `Il tragitto dura circa ${minutes} minuti.`, "Mi occupo io dei suoi bagagli."] },
  pt: { name: "Português", lines: ({ name, minutes }) => [`Olá ${name}, damos-lhe as boas-vindas!`, "Hoje viaja comigo, com a CliCab.", `A viagem dura cerca de ${minutes} minutos.`, "Eu trato da sua bagagem."] },
  nl: { name: "Nederlands", lines: ({ name, minutes }) => [`Hallo ${name}, welkom!`, "Ik ben vandaag uw chauffeur van CliCab.", `De rit duurt ongeveer ${minutes} minuten.`, "Ik zorg voor uw bagage."] },
};

/** Langue de la carte : celle du voyageur si elle est prise en charge, l'anglais sinon. Code « pt-BR » → « pt ». */
export function welcomeLang(code: string | null | undefined): Lang {
  const base = (code ?? "").toLowerCase().split(/[-_]/)[0];
  return (base === "fr" || (WELCOME_LANGS as readonly string[]).includes(base) ? base : "en") as Lang;
}

/** Les phrases dans la langue du voyageur, et leur traduction française pour le chauffeur. */
export function welcomeCard(code: string | null | undefined, passengerFirstName: string, minutes: number) {
  const lang = welcomeLang(code);
  const p = { name: passengerFirstName.trim() || "", minutes: Math.max(1, Math.round(minutes)) };
  return { lang, languageName: T[lang].name, lines: T[lang].lines(p), french: T.fr.lines(p) };
}
