# Stratégie de conquête des chauffeurs

> Document de travail. Tout ce qui est chiffré ici est une **proposition à décider ou une hypothèse à valider**, pas un fait mesuré. Je n'ai pas vérifié ce que font aujourd'hui Allocab, Sixt Ride, LeCab ou Uber : les comparaisons ci-dessous sont à contrôler (comptes chauffeurs, témoignages) avant d'être utilisées en public.

## 1. Le constat honnête

- Aucune fonctionnalité isolée n'est un avantage durable : un concurrent peut copier un écran en quelques semaines. Ce qui ne se copie pas vite : **la confiance des chauffeurs, la qualité de la demande et un communauté qui s'entraide**.
- Le chauffeur indépendant arbitre sur quatre choses : **combien je gagne net, si je suis payé à l'heure, si on me respecte, si j'ai du travail régulier**. Tout message qui n'y répond pas est du bruit.
- Le vrai problème de départ est l'œuf et la poule : les chauffeurs viennent s'il y a des courses, les partenaires signent s'il y a des chauffeurs. On ne le résout pas par la publicité mais en **séquençant** (section 5).

## 2. Positionnement (une phrase)

> **« La seule plateforme où le prix est affiché dès le départ, où l'on ne vous laisse jamais seul face à un problème, et où votre fiabilité se transforme en avantage. Prévenir tôt coûte peu ; les récidivistes sont sanctionnés, ce qui protège les chauffeurs sérieux. »**

Trois promesses, chacune déjà portée par le produit :

| Promesse | Ce que le produit fait déjà | Preuve à montrer |
|---|---|---|
| **Transparence totale** | Prix client, plafond et prix accepté détaillés dans la confirmation (application + e-mail) ; le prix proposé monte, ne baisse jamais ; calculé côté serveur | Capture de la confirmation ; démonstration de l'échelle de prix |
| **Jamais seul : les sauveteurs** | Appel à un chauffeur d'élite en cas de souci, avec une pénalité réduite (mission sauvée) ; prime pour le repreneur ; coût annoncé avant la décision | Démonstration de bout en bout (parcours testé) |
| **Votre sérieux est récompensé** | Note, fiabilité, statut sauveteur, tableau de performance par chauffeur et par société | Tableau de performance, critères visibles dans l'app |

Complété par des protections de terrain : suivi de vol (l'attente et le « client absent » se calculent sur l'heure réelle d'atterrissage), indemnité d'annulation versée au chauffeur, relevé de paiements lisible par société.

## 2 bis. « Conçue par des chauffeurs, pour des chauffeurs » : ce qu'il faut pour que ce soit vrai

C'est notre meilleur argument auprès des chauffeurs, à condition de le **prouver** : un chauffeur repère tout de suite un discours de bureau.
- **Dire la vérité sur l'équipe** : années de VTC, plateformes pratiquées, par qui. Si l'équipe n'a pas ce vécu, ne pas écrire « conçue par des chauffeurs » ; écrire « conçue avec des chauffeurs » et le montrer.
- **Les manquements des autres applications** (prix flou, annulations sans indemnité, attente non payée, sanctions brutales) viennent de récits de chauffeurs : **non vérifiés plateforme par plateforme**. Les documenter par des entretiens (citations signées avec accord) avant de les affirmer en public.
- **Comité de chauffeurs** (à organiser) : 8 à 12 chauffeurs qui testent chaque règle (barème de pénalités, sauveteurs, plancher de rémunération) avant publication. Une règle qu'ils jugent injuste est revue.
- **Principe de conception : une journée à risque réduit.** Pour chaque risque d'une journée de chauffeur, une réponse ou un écart assumé :

| Risque d'une journée | Couvert aujourd'hui | Écart |
|---|---|---|
| Prix incertain | Prix affiché, plafond connu, plancher de 9 € | Garanties horaire et kilométrique à étudier |
| Annulation tardive | Indemnité d'annulation (barème provisoire) | Barème à valider avec les chauffeurs et les partenaires |
| Attente, vol retardé, client absent | Suivi de vol, attente sur l'heure réelle, client absent après 15 min | Source de données de vol à brancher (Flightradar24 visé) |
| Panne, malaise | Sauveteurs | Liste vide au lancement |
| Contrôle routier | Justificatif de réservation dans l'application | Rappel des échéances (contrôle technique annuel, carte professionnelle, assurance, registre) : **la fiche Service-Public précise qu'aucun rappel n'est envoyé au chauffeur** |
| Compte suspendu sans comprendre | Barème annoncé, examen humain avant fermeture | Recours organisé, délai de réponse |
| Client agressif, accident | Rien | **Signalement d'incident et alerte sécurité à concevoir** |
| Non-paiement, paiement tardif | Relevé de paiements lisible | **Paiements réels et délai de paiement à fixer** (Stripe non branché) |
| Assurance | Contrôle du document | Couverture d'un relais de mission à définir |

Les deux écarts les plus parlants pour un chauffeur sont probablement le **rappel d'échéances** (peu coûteux, utile tous les jours) et le **signalement d'incident**.

## 3. Pourquoi les sauveteurs sont un bon levier (et leurs limites)

**Ce que ça résout pour chacun**
- *Chauffeur en difficulté* : une sortie encadrée qui coûte moins qu'une restitution sèche, mais pas rien : la responsabilité d'anticiper reste la sienne.
- *Chauffeur élite* : une source de revenu en plus (prime), un statut visible, des missions déjà qualifiées.
- *Partenaire (Booking, agences)* : une garantie de service que les autres n'offrent pas. C'est l'argument commercial le plus fort : « un transfert qui n'est jamais abandonné ».
- *Plateforme* : moins d'annulations tardives, donc meilleur taux de service, la métrique qui compte pour les grands comptes.

**Risques à traiter, pas à ignorer**
- *Abus* : un chauffeur « délègue » les courses peu rentables. Garde-fous en place : seulement avant prise en charge, **pénalité progressive selon le délai (jamais gratuite)**, récidive sanctionnée (suspension 48 h, 7 jours, examen), 3 appels par mois, motif obligatoire, historique tracé. À surveiller : taux d'appels par chauffeur.
- *Responsabilité* : assurance, registre VTC et contrat lors d'un transfert entre deux indépendants. **À faire valider par un juriste avant le pilote.**
- *Liste vide* : au lancement, il y aura peu de chauffeurs à ≥ 30 missions. Les seuils sont réglables ; commencer plus bas (par ex. 10 missions) puis monter.
- *Économie* : la prime (10 € par défaut) vient de la marge. À ~20 % de commission sur une course de 55 €, la marge est ~11 € : la prime en consomme la quasi-totalité. À ne payer que sur mission reprise, et à réévaluer avec les vrais volumes.
- *Ce n'est pas un avantage décisif seul* : à présenter comme la pièce signature d'un ensemble, pas comme la raison unique de venir.

## 4. Les arguments par profil

**Chauffeur indépendant** : transparence du prix, filet de sécurité, indemnité d'annulation, paiement lisible. Éviter de promettre un revenu : on n'a pas de données.
**Société de VTC (flotte)** : espace société (chauffeurs, véhicules, performance, relevé), un seul interlocuteur, pas de surcoût caché. **C'est le canal le plus rentable** : un gérant apporte 5 à 30 chauffeurs d'un coup.
**Chauffeur d'élite** : statut sauveteur, prime, missions premium, reconnaissance.

## 5. Séquencer pour sortir de l'œuf et la poule

1. **Zone et créneau limités** : Paris, transferts aéroports (CDG/Orly) et gares. Mieux vaut bien servir un petit périmètre que mal servir une ville.
2. **Demande d'abord, mais petite et réelle** : 2 à 3 agences ou hôtels partenaires qui s'engagent sur un volume de départ (même modeste). Sans cela aucun chauffeur ne reste.
3. **Chauffeurs ensuite, par les sociétés** : recruter 3 à 5 sociétés de VTC qui ont déjà des chauffeurs et peu de clients B2B, plutôt que 100 indépendants un par un.
4. **Un noyau d'élite dès le début** : inviter personnellement 10 à 20 chauffeurs sérieux comme « sauveteurs fondateurs » (seuils abaissés, statut visible). Ils font la qualité, et servent de preuve sociale.
5. **Ouvrir seulement quand le taux de service est bon** (voir KPIs). Un mauvais début de service détruit la réputation chez les chauffeurs comme chez les partenaires.

## 6. L'offre aux pionniers (à décider)

Propositions, chacune coûte de la marge, donc à valider avec le modèle financier :
- **Commission réduite ou garantie pour les N premières semaines** (par ex. plafonnée), puis publique et simple.
- **Statut « chauffeur fondateur »** : badge, priorité sur les missions premium, accès direct à l'équipe.
- **Paiement rapide et lisible** : le délai de paiement est souvent un point de friction ; s'engager sur un délai que Stripe et la trésorerie permettent réellement.
- **Aucune pénalité cachée** : règles écrites en une page, y compris pour les annulations et le client absent.
Ne pas promettre de minimum de courses garanti sans demande contractée.

## 7. Canaux (du plus au moins rentable, à tester)

1. **Gérants de sociétés VTC** : prise de contact directe, démonstration de l'espace société (c'est le seul outil de ce type dans notre périmètre actuel, à vérifier chez les concurrents).
2. **Zones d'attente aéroport / gare** : présence physique, QR code, démonstration sur téléphone en 3 minutes. Fort en preuve, limité en volume.
3. **Groupes de chauffeurs** (WhatsApp, Facebook, Telegram) : y entrer par l'utilité (explication de l'échelle de prix, des droits), pas par la publicité. Respecter les règles des groupes.
4. **Parrainage** : un chauffeur ou une société qui amène un chauffeur actif (≥ N missions) reçoit une prime. Payer à l'activité, jamais à l'inscription.
5. **Écoles et formateurs VTC** : candidats qui cherchent leur premier client.
Éviter dans un premier temps : publicité payante généraliste (coût élevé, qualité faible).

## 8. Objections et réponses

| Objection | Réponse honnête |
|---|---|
| « Vous n'avez pas encore de courses » | Vrai. Montrer les contrats ou volumes engagés dès qu'ils existent ; avant, proposer le statut fondateur et la transparence. |
| « Le prix qui monte me fait attendre » | Le prix monte jusqu'à un plafond connu et affiché ; aucun prix caché. On surveille le délai d'acceptation et on ajuste l'échelle. |
| « Les pénalités sont trop dures » | Elles sont annoncées avant la décision, progressives, et une dérogation existe sur justificatif (accident, urgence médicale). Les partenaires paient la fiabilité : c'est ce qui finance de bonnes courses. |
| « Les sauveteurs, c'est du travail en plus pour les autres » | Adhésion volontaire, prime, aucune obligation d'accepter. |
| « Vous prenez quoi comme commission ? » | Répondre précisément (confirmation détaillée) ; ne pas esquiver. |
| « Qui est responsable en cas de souci ? » | À préparer avec le juriste avant de pouvoir répondre ; ne pas improviser. |

## 9. Indicateurs de suivi

Chauffeurs : inscrits → validés (documents) → actifs sur 30 jours ; délai médian d'acceptation ; taux d'acceptation ; taux d'annulation par chauffeur ; rétention à 30 / 90 jours ; note moyenne ; NPS chauffeur.
Sauveteurs : nombre de sauveteurs listés ; appels / mois ; délai médian de reprise ; taux de reprise ; taux d'appels par chauffeur (abus) ; missions sauvées / missions à risque.
Service : taux de missions servies sans annulation tardive ; missions « sans chauffeur » ; ponctualité (suivi de vol).
Économie : coût d'acquisition par chauffeur actif ; marge moyenne par mission après primes.
Ces indicateurs existent en grande partie dans le tableau de performance ; ceux sur l'acquisition sont à ajouter.

## 10. Plan 30 / 60 / 90 jours (proposition)

**0–30 jours : valider avant de construire plus**
- 20 entretiens de chauffeurs et 5 gérants (questions en section 11).
- Faire relire par un juriste : statut du chauffeur, transfert de mission, transparence de la rémunération.
- Identifier 2–3 agences/hôtels prêts à donner un volume pilote.
- Démonstration préparée (parcours complet + sauveteurs).

**31–60 jours : pilote fermé**
- 3–5 sociétés et 10–20 chauffeurs fondateurs (dont les premiers sauveteurs).
- Premiers vrais paiements (Stripe), vrais SMS/e-mails, notifications push.
- Mesurer délai d'acceptation et taux de service ; ajuster l'échelle de prix et les seuils sauveteurs.

**61–90 jours : ouverture contrôlée**
- Parrainage ouvert, présence en zones d'attente, témoignages chauffeurs.
- Dossier pour grand compte (taux de service, délais, garantie sauveteurs) fondé sur les mesures du pilote.

## 11. Hypothèses à valider (questions d'entretien)

1. Combien de courses par semaine refusez-vous ou annulez-vous, et pourquoi ?
2. Qu'est-ce qui vous a fait quitter ou quitter à moitié une plateforme ?
3. En cas de panne ou de souci, que faites-vous aujourd'hui ? Auriez-vous utilisé un sauveteur ? À quelles conditions seriez-vous sauveteur ?
4. Un prix qui monte jusqu'à un plafond connu : vous attendez, ou vous prenez tout de suite ? À partir de quel écart acceptez-vous ?
5. Quel délai de paiement vous convient, et quelle commission vous semble acceptable ?
6. Qui vous apporte des chauffeurs (société, groupes, bouche à oreille) ?
**Hypothèses qui font tomber ou changent le plan si elles sont fausses** : (a) les chauffeurs veulent un filet de sécurité plus qu'un meilleur prix ; (b) il existe assez de chauffeurs éligibles pour une liste utile ; (c) les partenaires valorisent la garantie sauveteur ; (d) le cadre juridique permet le transfert de mission.
