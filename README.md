# VTC Platform

Plateforme B2B2C de transferts VTC à prix fixe (API partenaires type Booking.com / Trip.com, app chauffeur, back-office).

- Cahier des charges & architecture : [docs/CAHIER_DES_CHARGES.md](docs/CAHIER_DES_CHARGES.md)
- Spec API partenaires : [docs/openapi.yaml](docs/openapi.yaml)

## Démarrage

```bash
pnpm install
cp .env.example .env
pnpm db:up                       # PostgreSQL/PostGIS + Redis
pnpm -F @vtc/api db:deploy       # migrations
pnpm -F @vtc/api seed            # règles de prix et forfaits
pnpm build && pnpm test          # les tests d'intégration utilisent la base `vtc_test`
pnpm -F @vtc/api dev             # API sur http://localhost:3000
```

### Démo bout-en-bout (simulateur de partenaire)

Avec l'API qui tourne (`ADMIN_TOKEN` défini) :

```bash
ADMIN_TOKEN=... API_URL=http://localhost:3000 pnpm -F @vtc/api simulate
```

Le simulateur crée un partenaire et deux chauffeurs, réserve un CDG → Paris à 55 €, fait accepter la course
(acceptation concurrente, un seul gagnant), la déroule jusqu'à la fin et vérifie les 6 webhooks signés.

## Structure

| Chemin | Contenu |
|---|---|
| `apps/api` | API NestJS + schéma Prisma (`prisma/schema.prisma`) |
| `apps/backoffice` | « Tour de contrôle » Next.js (port 3001) : missions en colonnes, suivi de vol, alertes, performance, chauffeurs, sociétés, partenaires, webhooks. **Espace société** sur `/societe` (clé d'accès) : performance, chauffeurs, véhicules, missions, relevé de paiements + CSV |
| `apps/driver-app` | App chauffeur Expo : Cap / Radar / Agenda, **mode mission** (carte Google Maps, vol, attente, pancarte), prise par appui maintenu (`pnpm -F @vtc/driver-app start`) |
| `apps/web-booking` | Site de réservation client — à initialiser (phase 2) |
| `packages/pricing` | Moteur de tarification pur, testé |
| `packages/shared` | Schémas Zod, machine à états des courses |
| `infra` | docker-compose |

## État de la phase 1

| Élément | État |
|---|---|
| API partenaires (clé API, devis 15 min, réservation idempotente, annulation, webhooks signés) | ✅ testé (PostgreSQL réel) |
| Dispatch (bourse, acceptation exclusive, relances, redistribution, alertes, attribution manuelle) | ✅ testé |
| Onboarding chauffeur (documents requis, validation) | ✅ testé — upload réel S3 : phase 2 |
| Back-office | ✅ vérifié dans un navigateur — authentification par token partagé (comptes nominatifs : phase 2) |
| App chauffeur | ✅ typée, bundle Android compilé, logique testée — **non essayée sur un téléphone/émulateur** |
| Routage, suivi de vol, push/SMS, paiements, e-signature | ⏳ phase 2 (stubs : `RoutingService`, `NotificationsService`) |

Connexion chauffeur en dev : téléphone d'un chauffeur créé via `/admin/drivers`, code `DRIVER_DEV_OTP` (000000 par défaut).

**Identité visuelle** : aplats bleu/jaune/rouge, serif massif, pastilles, grain d'impression (voir `apps/driver-app/src/theme.ts`). « ÉTOILE » est un nom de travail : il se change dans une seule constante (`BRAND`) et dans le back-office.

## Google Maps (app chauffeur)

La carte native utilise Google Maps. La clé n'est jamais commitée : `GOOGLE_MAPS_API_KEY=... npx expo run:android` (ou variable d'environnement du build EAS).
Sans clé, la carte native reste vide ; sur le web, un schéma sans carte est affiché. Le tracé est une ligne droite (pas d'itinéraire routier).

## Suivi de vol

Le retard est mesuré par rapport à l'heure d'arrivée prévue (`pickupAt`). `POST /admin/rides/:id/flight` (opérateur) et le fournisseur branchable
(`FlightsService.provider`, interface `FlightProvider`) passent par le même chemin : webhook `flight.delayed`, notification chauffeur, heure effective,
et décompte du no-show à partir de l'heure effective. **Aucun fournisseur de données de vol n'est branché pour l'instant.**

### Statuts du vol et notifications (retard, avance, atterri, annulé)
Cinq statuts : `SCHEDULED` (à l'heure), `DELAYED` (retard à partir de 15 min d'après l'atterrissage prévu), `EARLY` (avance de 10 min ou plus), `LANDED`, `CANCELLED`. À chaque changement de statut, de retard ou d'avance :
- **Chauffeur** : message dans l'application (Messages) avec le titre du changement : « retardé (+N min) », « en avance (−N min) », « de nouveau à l'heure », « atterri », « annulé » (celui-ci aussi par e-mail). Le statut est visible sur la mission (carte du vol colorée : jaune retard, rouge annulé) et dans l'agenda.
- **Partenaire** : webhook `flight.updated` (nouveau, couvre tous les changements ; la réservation porte `flight.status`, `delayMin`, `earlyMin`) ; `flight.delayed` est conservé pour la compatibilité. C'est au partenaire de prévenir son client final : nous ne contactons pas les passagers.
- **Équipe** : saisie dans le tableau (retard +, avance −, boutons « Atterri » et « Annulé ») ou par un fournisseur de données de vol (adaptateur `FlightProvider`, **aucun n'est branché** : tant que ce n'est pas fait, le statut vient de l'opérateur).
- **Avance** : l'heure de prise en charge convenue **ne change pas** (le chauffeur est invité à arriver un peu avant) ; seul le retard décale l'heure effective et le « client absent ».
- **Un vol posé ou annulé le reste** : une estimation tardive d'un fournisseur ne le remet pas « en retard ».
- **Vol annulé** : le chauffeur est prévenu de ne pas se déplacer, une alerte « Vol annulé » apparaît dans l'onglet Alertes, mais **la mission n'est pas annulée automatiquement** : annuler, reporter ou maintenir est une décision commerciale avec le partenaire (frais d'annulation, indemnité du chauffeur).
**Non fait** : notification push (message dans l'application seulement), notification directe au passager, branchement d'un fournisseur de données de vol réel (coût, contrat, clé API).

## Comptes du back-office

Le back-office utilise des comptes nominatifs (mot de passe haché scrypt, verrouillage 15 min après 5 échecs, sessions de 8 h révoquées au changement de mot de passe ou à la désactivation, journal d'audit, rôles Administrateur / Régulateur).
Premier administrateur :

```bash
ADMIN_PASSWORD='une phrase de passe longue' pnpm -F @vtc/api admin:create vous@exemple.fr "Votre Nom"
```

`ADMIN_TOKEN` (en-tête `x-admin-token`) reste un **token de service** pour les scripts et le simulateur ; sans cette variable, il est refusé. Derrière un proxy, définir `TRUST_PROXY=1`.

## Connexion des chauffeurs (code SMS)

`POST /driver/otp {phone}` envoie un code à 6 chiffres (5 min, 5 essais, 1 renvoi / 30 s, 3 demandes / 10 min, réponse identique pour un numéro inconnu) ; `POST /driver/login {phone, code}` le vérifie. Seule l'empreinte HMAC est stockée.
Fournisseur : `SMS_PROVIDER=twilio` (adaptateur écrit d'après la documentation, **non essayé contre un vrai compte**) ; en production sans fournisseur, l'envoi répond 501.
Pour le simulateur et les démos locales, lancer l'API avec `DRIVER_DEV_OTP=000000` (interdit en production).

## Charte graphique

Fond **bleu ciel** `#8fd0f5` avec texte **bleu nuit** `#0b2a4a` posé dessus (contraste 8,7) ; **bleu soutenu** `#1a66c2` pour les boutons et pastilles (texte crème dessus : 4,9) ; jaune `#f7b30a` et rouge `#ee2a14` en accents ; crème `#f5eedd` pour les cartes.
Le rouge et le jaune ne servent jamais de couleur de texte directement sur le fond ciel (contraste insuffisant). Définition : `apps/driver-app/src/theme.ts` et `apps/backoffice/app/globals.css`.

## E-mails et messages au chauffeur : acceptation et annulation

Deux messages, dans l'app (Messages) et par e-mail : **confirmation** quand le chauffeur accepte une mission (ou que le dispatch la lui attribue) — référence, prise en charge, trajet, vol, service, prix client / commission / rémunération nette — et **annulation**. Aucune donnée du passager n'est envoyée par e-mail (elles restent dans l'app).
`DRIVER_SEES_CLIENT_PRICE=0` masque le prix client et la commission (seule la rémunération nette reste visible).

Quand un partenaire annule une mission déjà attribuée, le chauffeur reçoit un message dans l'app (Messages, avec pastille) et un e-mail : référence `R-xxxxxx`, prise en charge, trajet, vol (atterrissage et délai de prise en charge), service, rémunération prévue, et indemnité éventuelle.
**Règle provisoire** (à valider commercialement) : frais d'annulation du partenaire selon l'anticipation (> 24 h : 0 % ; 2–24 h : 50 % ; < 2 h : 100 %), dont le chauffeur reçoit la part nette de commission. L'indemnité figure sur le relevé de la société à la date d'annulation.
E-mail : `EMAIL_PROVIDER=resend` (adaptateur écrit d'après la documentation, non essayé contre un vrai compte) ; sans fournisseur, le message reste dans l'application.

## Échelle de prix chauffeur (prix qui monte à l'approche de la mission)

Le prix **client** est fixe. À la réservation, la plateforme calcule un **plafond** pour le chauffeur (prix client − commission de base : le « prix partenaire prévisionnel »).
Le prix **proposé** au chauffeur part à 85 % du plafond et monte linéairement entre 24 h et 1 h avant la prise en charge, pour atteindre le plafond ; le premier qui accepte prend **le prix du moment** (« prix partenaire accepté »). L'écart avec le plafond s'ajoute à la marge de la plateforme.
Exemple (réel, testé) : client 55 € → plafond 44 € → proposé 37,40 € à 3 jours, 40,80 € à 12 h, 43,80 € à 1 h 30, 44 € à moins d'1 h.

- Le prix est **calculé côté serveur** à l'instant de l'acceptation ; le chauffeur ne peut pas l'imposer. Il peut monter entre l'affichage et l'acceptation, jamais baisser.
- Le dispatch peut imposer un prix à l'attribution manuelle, **jamais au-dessus du plafond**.
- L'indemnité d'annulation suit le prix réellement accepté. Les missions antérieures à l'échelle gardent leur prix net comme plafond.
- La marge de la plateforme (« Marge plateforme », « Gain échelle ») n'est visible que dans l'administration, jamais côté société ni dans les messages au chauffeur.
- Réglages : `PRICE_LADDER`, `LADDER_START_RATIO` (jamais sous 30 %), `LADDER_FROM_MIN`, `LADDER_TO_MIN`, `LADDER_STEP_CENTS`.

**Points de vigilance** : (1) un chauffeur peut attendre que le prix monte, donc une mission peu attractive risque d'être prise tard ou pas du tout : surveiller le délai moyen d'acceptation et les alertes « sans chauffeur » ; un partenaire comme Booking juge d'abord la fiabilité. (2) La transparence de la rémunération des chauffeurs indépendants est encadrée (directive européenne sur le travail via plateformes) : faire valider la formulation et les informations affichées par un juriste.

## Les sauveteurs (entraide encadrée entre chauffeurs)

Un chauffeur à qui il arrive un problème (panne, malaise, retard impossible à rattraper) peut, **avant d'avoir le client à bord ou sur place**, appeler un **sauveteur** : un chauffeur d'élite qui reprend la mission à sa place : **le demandeur paie une pénalité réduite** (voir plus bas) mais la mission est sauvée, et sans que le client ni le partenaire n'aient de mission annulée (le partenaire reçoit un nouvel événement `driver.assigned`).

- **Accès à la liste** : compte actif, note ≥ 4,8, fiabilité ≥ 90 %, ≥ 30 missions terminées (réglables : `RESCUE_*`), **et adhésion volontaire** ; l'équipe peut retirer ou rétablir le statut. Les critères sont recalculés à chaque appel : une note qui baisse fait sortir de la liste.
- **Appel** : ciblé (un sauveteur choisi dans la liste, triée par proximité du départ) ou **diffusé** à tous les sauveteurs adaptés (catégorie de véhicule, planning libre). La liste n'affiche ni téléphone ni nom complet ; le passager n'est connu du sauveteur qu'après acceptation.
- **Reprise atomique** : le premier qui accepte prend la mission en une transaction (un seul gagnant, même en acceptations simultanées). Il reçoit la confirmation habituelle (application + e-mail), le demandeur est prévenu.
- **Prime** de 10 € (`RESCUE_BONUS_CENTS`) pour le sauveteur, **prélevée sur la commission** (jamais sur le prix client, jamais au-delà de la commission).
- **Expiration** : une demande expire au bout de 30 min au plus (moitié du temps restant avant la prise en charge). Si personne ne répond, la mission reste au demandeur, qui est prévenu, et l'équipe voit l'alerte « sans repreneur » (onglet Alertes).
- **Garde-fous** : une seule demande ouverte par mission, 3 appels maximum par mois et par chauffeur (au-delà : support), pénalité et récidive (section suivante), historique complet dans les événements de la mission (`rescue.requested`, `ride.rescued`, `rescue.expired`).

Endpoints chauffeur : `GET /driver/rescue/status|rescuers?rideId=|incoming|mine`, `POST /driver/rescue/opt-in|request|:id/accept|decline|cancel`. Administration : `GET /admin/rescues`, `POST /admin/drivers/:id/rescue-revoke|rescue-restore`.
**Non résolu / à valider** : la responsabilité (assurance, registre VTC, contrat) lors d'un transfert de mission entre deux indépendants doit être validée par un juriste ; la prime et les seuils sont des valeurs de départ, à ajuster avec les premiers chauffeurs.

## Pénalités et récidive (mission rendue ou sauveteur)

Principe : **anticiper doit coûter moins cher que s'y prendre tard, et ne rien faire ne doit jamais être gratuit.** Le montant est affiché au chauffeur **avant** qu'il décide (carte « Annuler maintenant » dans « Un souci ? »).

| Délai avant la prise en charge (heure effective, vol retardé inclus) | Mission rendue | Appel d'un sauveteur repris |
|---|---|---|
| plus de 48 h | 10 € | 10 € (plancher) |
| 24 à 48 h | 20 € | 10 € (plancher) |
| 6 à 24 h | 100 % de la rémunération | moitié de la pénalité de restitution (10 € mini) |
| moins de 6 h | 150 % de la rémunération | idem |

- Pour l'appel d'un sauveteur, le délai se mesure **au moment de la demande** (attendre ne réduit pas la pénalité), et la pénalité n'est due que si un sauveteur reprend effectivement la mission.
- **Récidive** (fenêtre glissante de 90 jours ; restitution = 1 point, appel de sauveteur = 0,5) : 3 points → suspension **48 h** ; 4 → **7 jours** ; 5 → suspension sans échéance et **examen par l'équipe** (la fermeture définitive est une décision humaine, jamais automatique). Les suspensions à durée limitée se lèvent seules.
- La pénalité est déduite sur le **relevé de la société** (ligne « Pénalité », montant négatif) et notifiée au chauffeur (application + e-mail) avec la sanction éventuelle.
- **Dérogation** : l'équipe peut annuler une pénalité sur justificatif (accident, urgence médicale), avec motif tracé ; elle ne compte alors plus dans la récidive.
- Réglages : `PENALTY_RESCUE_RATIO`, `PENALTY_RESCUE_MIN_CENTS`, `PENALTY_WINDOW_DAYS`. Les paliers sont dans `apps/api/src/penalties.ts`.

**À valider avant le pilote** : (1) ce barème est une proposition inspirée de pratiques de marché citées par un chauffeur, **non vérifiées** ; (2) une pénalité contractuelle de plus de 100 % du prix est une « clause pénale » que le juge peut réduire : le contrat chauffeur doit la prévoir, la justifier et la faire accepter ; (3) suspensions et fermetures de comptes d'indépendants : cadre de transparence et de recours imposé aux plateformes, à faire relire ; (4) le prélèvement effectif dépend des paiements (Stripe), pas encore branchés : aujourd'hui la pénalité est enregistrée et affichée au relevé. Les missions déjà attribuées à un chauffeur suspendu automatiquement ne sont pas encore réattribuées.

## Critères d'admission du véhicule (obligatoires)

Un chauffeur n'est **validé** que si au moins un de ses véhicules actifs respecte les critères, et il ne reçoit **aucune offre** ni attribution (dispatch, attribution manuelle, reprise de sauveteur) avec un véhicule non conforme. Le contrôle est refait à chaque attribution : un véhicule peut devenir non conforme avec le temps. Une information absente compte comme un défaut.

| Critère | Thermique | Hybride ou électrique | Réglage |
|---|---|---|---|
| Places (chauffeur compris) | 4 à 9 | 4 à 9 | `VEHICLE_MIN_SEATS`, `VEHICLE_MAX_SEATS` |
| Portes | au moins 4 | au moins 4 | `VEHICLE_MIN_DOORS` |
| Âge depuis la première mise en circulation (champ B de la carte grise) | moins de 7 ans | exempté | `VEHICLE_MAX_AGE_YEARS` |
| Longueur / largeur hors tout | ≥ 4 500 mm / ≥ 1 700 mm | exempté | `VEHICLE_MIN_LENGTH_MM`, `VEHICLE_MIN_WIDTH_MM` |
| Puissance nette | au moins 84 kW | exempté | `VEHICLE_MIN_POWER_KW` |

Documents ajoutés : **carte grise** et **contrôle technique** (ce dernier doit porter une date d'échéance ; il est annuel pour un VTC d'après la source consultée). `VEHICLE_RULES=0` désactive le contrôle (développement uniquement).

**Source.** Fiche Service-Public « Devenir chauffeur de VTC » (vérifiée le 12/08/2026), qui confirme ces valeurs (arrêté du 26 mars 2015). Les arrêtés eux-mêmes n'ont pas été lus : confirmation par un juriste avant le pilote. Voir `docs/EXIGENCES_REGLEMENTAIRES.md` pour l'ensemble des exigences et des écarts (revenu horaire et kilométrique, modèle sociétés/chauffeurs, sanctions pénales, transparence). Voiture de collection : exemptée d'âge (champ `collector`). Non traités : vignette et dispositifs lumineux (non vérifiables à distance), deux ou trois roues.

**Identité d'exploitant** (nécessaire au justificatif de réservation et à la validation) : numéro de carte professionnelle, et soit Siret + n° REVTC du chauffeur indépendant, soit ceux de sa société. Le chauffeur les renseigne via `POST /driver/identity`.
**Revenu minimal** : 9 € net de commission par course (`MIN_DRIVER_PAY_CENTS`), appliqué au devis et au prix proposé.

## Identité du chauffeur et lutte contre le prêt de compte

Prêter son compte (ou son inscription au registre des VTC) à un tiers expose le chauffeur, la société et la plateforme à de lourdes sanctions (voir `docs/EXIGENCES_REGLEMENTAIRES.md`). Le produit combine :
- **Écran « Mon identité »** (onglet Cap) : informations d'exploitant (raison sociale, Siren/Siret, n° REVTC, carte professionnelle) et selfie. Un chauffeur rattaché à une société ne renseigne que sa carte professionnelle.
- **Photo de profil** : la photo de référence (premier selfie, validée par l'équipe) sert de photo de compte. Elle s'affiche dans l'application (écran « Mon identité » et carte d'accueil, estompée tant qu'elle n'est pas validée) et sur la fiche chauffeur du back-office (`GET /admin/drivers/:id/photo`, chargée à la demande). Elle n'est pas montrée aux autres chauffeurs.
- **Consentement du chauffeur** : montrer la photo au voyageur est facultatif. Le chauffeur accepte ou retire son accord à tout moment dans « Mon identité » (`POST /driver/identity/photo-consent`, `{accept}`) ; chaque changement est journalisé (`photo.consent`, `photo.consent_withdrawn`) et un refus n'a aucune conséquence sur ses courses. Sans accord ou sans photo validée, le voyageur voit le prénom, le véhicule et la plaque, mais pas la photo. Les chauffeurs existants n'ont pas consenti : rien n'est montré tant qu'ils n'ont pas accepté.
- **Écran client (suivi du trajet)** : `apps/web-booking` (Next.js, port 3002). Chaque réservation reçoit un lien secret `trackingUrl` (`TRACKING_BASE_URL/suivi/<jeton>`, 192 bits, sans compte) que le partenaire transmet au voyageur. La page (français ou anglais selon la langue du voyageur, actualisée toutes les 10 s) montre l'avancement, l'heure, les adresses, la pancarte, le statut du vol, et, de l'attribution à la fin de la course, le prénom du chauffeur, son véhicule, sa plaque et sa photo (si consentie). Jamais le téléphone, le nom de famille, le prix ni la position en direct. L'API publique correspondante : `GET /track/:jeton` et `GET /track/:jeton/photo` ; ajouter l'adresse du site à `CORS_ORIGINS`. Partenaires : `GET /v1/bookings/:id/driver-photo` (même règles). Limites : pas de carte ni de position en direct, pas d'image Docker pour ce site.
- **Envoi du lien au voyageur** : à la confirmation de la réservation, le voyageur reçoit son lien par SMS (au numéro fourni) et par e-mail (si une adresse est fournie), dans sa langue (français, sinon anglais). Chaque canal est indépendant : l'échec de l'un n'empêche ni l'autre ni la réservation. Un seul envoi par réservation (`Booking.trackingSentAt`, un rejeu idempotent n'en déclenche pas un second). Les clés de test (sandbox) n'envoient rien sauf `TRACKING_NOTIFY_SANDBOX=1`. Un partenaire qui préfère transmettre le lien lui-même est réglé par `notifyPassenger: false` à sa création. Les fournisseurs sont ceux du reste de l'application (`SMS_PROVIDER`, `EMAIL_PROVIDER`) ; Twilio et Resend sont écrits d'après leur documentation et pas essayés contre un vrai compte. Le numéro est transmis tel que fourni par le partenaire : il doit être au format international (+33…) pour qu'un fournisseur réel l'accepte. Aucun SMS n'est envoyé aux changements de statut ni en cas de retard de vol (pour l'instant, le voyageur consulte la page).
- **Photo de référence** : le premier selfie est **validé par un humain** (comparaison avec la pièce d'identité) avant la première mise en ligne.
- **Selfie de prise de service** : un selfie est demandé pour se mettre en ligne s'il date de plus de 12 h (`IDENTITY_CHECK_HOURS`). Les chauffeurs en ligne dont le selfie expire sont remis hors ligne (hors mission en cours). Les selfies de service sont **conservés 30 jours** (`IDENTITY_RETENTION_DAYS`) puis supprimés ; la référence est gardée tant que le compte existe.
- **Vérifications aléatoires en cours de service** : toutes les 5 s, chaque chauffeur en service (en ligne, ou avec une mission assignée) a une petite probabilité d'être sollicité (tirage exponentiel, **une fois toutes les 4 h en moyenne**, `IDENTITY_SPOT_MEAN_MIN`), jamais moins de 90 min après son dernier selfie (`IDENTITY_SPOT_MIN_GAP_MIN`). Une fenêtre s'impose dans l'application avec un compte à rebours (**10 min**, `IDENTITY_SPOT_DEADLINE_MIN`) : le selfie répond à la demande. **Jamais pendant une course en cours** : la demande est suspendue (et reportée, sans pénalité) jusqu'à la fin. Sans réponse : vérification **manquée**, chauffeur remis hors ligne, il reprend un selfie normal ; le nombre de vérifications manquées sur 30 jours est visible de l'équipe, qui décide (aucune sanction automatique). L'équipe peut aussi **demander un selfie immédiat** à un chauffeur (bouton « Demander un selfie »). `IDENTITY_SPOT=0` désactive les vérifications aléatoires.
- **Contrôle par l'équipe** (onglet Alertes) : photos à valider, selfies récents à comparer à la référence ; un visage différent est **signalé** : le compte est suspendu pour examen, le chauffeur est prévenu.
- `IDENTITY_CHECKS=0` désactive le contrôle (développement).

**Choix assumé : pas de reconnaissance faciale automatique.** Comparer des visages par algorithme est un traitement de données biométriques (RGPD, article 9 : interdit par principe, avec exceptions étroites ; analyse d'impact obligatoire). Le contrôle repose donc sur un **humain** et sur l'effet dissuasif d'un selfie horodaté conservé. C'est plus faible qu'un contrôle automatique : un chauffeur et un complice peuvent encore se présenter l'un pour l'autre tant que personne ne compare. Pistes si le risque se confirme : fournisseur de vérification d'identité certifié (document + visage, avec consentement explicite et analyse d'impact), liaison appareil-compte, détection de la même personne sur plusieurs appareils, vérification de la validité des cartes via le portail officiel.
**Limites actuelles** : les selfies sont stockés dans la base de données (prototype) : stockage chiffré à prévoir ; la capture par la caméra de l'application a été testée sur le web (sélecteur de fichier), pas sur un téléphone ; la demande arrive dans l'application (interrogation toutes les 10 s) et par un message : **pas encore de notification push**, donc un chauffeur dont l'application est fermée ne la voit qu'à la réouverture (il est alors hors ligne de fait) ; les seuils (4 h, 90 min, 10 min) sont des valeurs de départ ; le consentement à la photo et la politique de conservation sont à intégrer à la politique de données (`docs/POLITIQUE_DONNEES_CHAUFFEURS.md`) et à faire valider par un DPO.

## Rappels d'échéances des documents

La fiche Service-Public indique qu'aucun rappel n'est envoyé au chauffeur pour son contrôle technique (annuel) : un contrôle expiré immobilise le véhicule. La plateforme s'en charge pour tous les documents obligatoires (carte professionnelle, permis, assurance, pièce d'identité ; avec le contrôle des véhicules : carte grise et contrôle technique).
- **Rappels** à 30, 14, 7 et 1 jours de l'échéance, puis le jour de l'expiration : message dans l'application, e-mail à partir de 7 jours. **Une seule fois par document et par palier.** Un document remplacé par un plus récent valide ne déclenche plus de rappel ; un document en attente de validation est ignoré.
- **À l'expiration d'un document obligatoire** : le chauffeur est mis **hors ligne** (jamais pendant une mission) et ne peut pas se remettre en ligne tant qu'il n'a pas de document valide (`DOCUMENTS_EXPIRED`). Son compte reste actif, la mesure est levée dès que le nouveau document est validé.
- **Application** : carte « Mes échéances » sur l'onglet Cap (rouge si expiré ou manquant, jaune sous 30 jours) et écran détaillé. **Équipe** : `GET /admin/expiring?days=30`.
- Passage horaire des rappels (`DeadlinesService.sweep`). **Non fait** : l'envoi d'un nouveau document depuis l'application (le stockage sécurisé des documents n'existe pas encore : le chauffeur contacte l'équipe), la date d'inscription au registre des VTC (5 ans) et l'assurance du véhicule non suivies séparément, notification push.

## Revenus du chauffeur

Onglet **Revenus** de l'application (et `GET /driver/earnings`) : net de la période (jour, semaine du lundi, quinzaine 1–15 / 16–fin, mois, ou un intervalle de 92 jours au plus), à l'heure de Paris.
- **Détail** : courses terminées, indemnités d'annulation, pénalités (déduites), montant à venir (missions attribuées), par jour, course par course. Le prix client et la commission ne figurent que si `DRIVER_SEES_CLIENT_PRICE` le permet.
- **Rendement par heure de mission** : (courses + indemnités) ÷ heures de mission, de la mise en route à la fin de la course. **Le temps en ligne sans mission n'est pas mesuré** (aucun journal de connexion) : ce n'est donc pas un « net par heure travaillée » au sens de la garantie de 30 €/h citée par Service-Public, dont le mode de calcul exact reste à établir. Une durée mesurée de moins de 5 minutes (touches enchaînées) est remplacée par la durée estimée du trajet ; plafond de 12 h par course.
- **Export CSV** (`GET /driver/earnings/csv`, séparateur « ; », virgule décimale) pour le comptable. Ce n'est pas une déclaration fiscale : les informations fiscales (URSSAF, TVA) ne sont pas traitées.

## Signalement d'incident

Bouton « Signaler un incident » (onglet Cap, et « Un souci ? » dans une mission) : danger (agression, menace), accident, panne, comportement d'un client, problème de paiement, contrôle routier, autre.
- **Trace horodatée avec position** (la position du moment, sinon la dernière connue) ; liée à la mission si elle est choisie (événement `driver.incident`). Danger et accident sont **urgents** par défaut ; le chauffeur peut forcer l'urgence.
- **Avant tout, les secours** : l'écran propose d'appeler le 112, 17, 15, 18, et la confirmation rappelle que **notre équipe n'est pas un service d'urgence**. Une panne propose aussi d'appeler un sauveteur ; un contrôle routier rappelle le justificatif de réservation.
- **Équipe** : carte « Incidents » en tête des alertes du back-office (urgences d'abord, téléphone du chauffeur, lien vers la carte), « Prendre en charge » puis « Clore » avec une résolution visible du chauffeur ; compteur dans l'onglet Alertes. 5 signalements par heure et par chauffeur au maximum.
- **Limites** : l'alerte n'arrive qu'au tableau de bord (**ni SMS, ni push, ni astreinte** : quelqu'un doit le surveiller ; aucun engagement de réponse 24 h/24 n'existe) ; pas de photo ni de pièce jointe ; pas de partage de position en continu.
