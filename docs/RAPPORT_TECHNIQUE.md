# CliCab : rapport technique

Plateforme B2B2C de transferts VTC à prix fixe : une API pour les agences et plateformes de réservation, une application pour les chauffeurs, un back-office d'exploitation, un espace société et une page de suivi pour le voyageur.
Document établi à partir du dépôt (branche `claude/optimistic-maxwell-sagq8e`). **Le nom « CliCab » est retenu mais n'a pas été vérifié** (marque, domaine, boutiques d'applications).

## 1. Vue d'ensemble

| Élément | Rôle | Techno | Port |
|---|---|---|---|
| `apps/api` | API métier : devis, réservations, dispatch, chauffeurs, sociétés, administration, suivi voyageur | NestJS 10, Prisma 5, PostgreSQL | 3000 |
| `apps/driver-app` | Application chauffeur (mobile et web) | Expo SDK 52, React Native 0.76, react-native-web | 8081 |
| `apps/backoffice` | « Tour de contrôle » et espace société | Next.js 14, React 18 | 3001 |
| `apps/web-booking` | Page publique de suivi du voyageur | Next.js 14, React 18 | 3002 |
| `packages/pricing` | Moteur de tarification pur | TypeScript | |
| `packages/shared` | Schémas de validation, machine à états, événements webhook | TypeScript, Zod | |

Taille : environ 10 800 lignes de TypeScript (hors dépendances), 25 modèles et 18 énumérations de données (587 lignes de schéma), 20 migrations, 94 routes HTTP, 7 documents de cadrage dans `docs/`.

```
Partenaires (API REST + webhooks signés)        Voyageur (SMS / e-mail → page de suivi)
            │                                              │
            ▼                                              ▼
        ┌────────────────────  API NestJS (3000)  ────────────────────┐
        │ devis · réservations · dispatch · sauveteurs · pénalités     │
        │ identité · vol · échéances · revenus · incidents · suivi     │
        └───────┬──────────────────────┬───────────────────────────────┘
                │ Prisma               │ fournisseurs externes (adaptateurs)
                ▼                      ▼ SMS Twilio · e-mail Resend · routage OSRM · vols
          PostgreSQL               (non essayés contre de vrais comptes)
                ▲
   Application chauffeur (Expo) · Back-office (Next) · Page de suivi (Next)
```

## 2. Technologies utilisées

### Langage, outils, organisation
- **TypeScript 5.6** partout (API, applications, paquets), en mode strict.
- **Monorepo pnpm 10.28** (espaces de travail `apps/*` et `packages/*`), **Node 22** en exécution (Node 20 minimum).
- **Tests : Vitest 2.1** ; **exécution TypeScript : tsx 4** ; **cross-env** pour les variables d'environnement sous Windows.
- **Intégration continue : GitHub Actions** (tests avec une base PostgreSQL 16, vérification des types, construction des images Docker).

### API (`apps/api`)
- **NestJS 10.4** (Express), injection de dépendances explicite (`@Inject`), **RxJS 7**, **reflect-metadata**.
- **Prisma 5.22** (ORM, migrations SQL versionnées) sur **PostgreSQL** (PostGIS 16 en développement, PostgreSQL 16 en production).
- **Zod 3** : validation des entrées, partagée avec les paquets.
- **Chiffrement et sécurité (modules `node:crypto`)** : clés API hachées SHA-256 (jamais stockées en clair), signature des webhooks en HMAC-SHA256 avec horodatage, jetons de session signés HMAC, mots de passe hachés avec scrypt, comparaisons en temps constant.
- Tâches de fond intégrées à l'API (minuterie) : redistribution des offres, livraison des webhooks avec reprise, balayage des sauveteurs, vérifications d'identité, rappels d'échéances, interrogation des vols.

### Application chauffeur (`apps/driver-app`)
- **Expo ~52**, **React Native 0.76**, **React 18.3**, **react-native-web** (version navigateur pour les démonstrations).
- Modules Expo : `expo-location` (position), `expo-image-picker` (selfie), `expo-secure-store` (jeton), `expo-font`, `expo-status-bar`.
- **react-native-maps 1.18** (carte Google Maps, clé nécessaire).
- Polices : Rozha One, Alfa Slab One, Anton, Kaushan Script. Identité graphique propre (aplats bleu, jaune, rouge).

### Back-office et page de suivi
- **Next.js 14 (App Router)**, **React 18**, sortie « standalone » pour Docker.
- Back-office : polices `@fontsource`. Page de suivi : styles CSS maison, français et anglais, en-têtes de confidentialité (pas d'indexation, pas de `Referer`, pas de cache).

### Infrastructure
- **Docker** : un Dockerfile par service (API, back-office, page de suivi), utilisateur non root, contrôles de santé.
- **Docker Compose de production** : PostgreSQL 16, API, back-office, page de suivi, service de sauvegarde, **Caddy 2** (HTTPS automatique Let's Encrypt, trois domaines).
- **Sauvegarde** : `pg_dump -Fc` quotidien, conservation 14 jours, restauration essayée.

### Fournisseurs externes prévus (adaptateurs écrits d'après leur documentation)
- SMS : **Twilio** ; e-mail : **Resend** ; routage routier : **OSRM** (avec repli à vol d'oiseau et cache) ; suivi de vol : **Flightradar24** envisagé (non intégré, mise à jour du vol par l'API d'administration et par webhook) ; paiement : **Stripe** (modélisé, pas branché).

## 3. Modèle de données

25 tables, dont :
- **Réservations** : `Partner`, `ApiKey`, `Quote`, `Booking`, `Ride`, `RideEvent`, `DispatchOffer`, `Rating`, `WebhookDelivery`.
- **Chauffeurs et flotte** : `Driver`, `Vehicle`, `Document`, `Company`, `Payout`.
- **Confiance et sécurité** : `IdentityCheck` (selfies), `DriverPenalty`, `RescueRequest`, `Incident`, `DocumentReminder`, `Notification`, `OtpCode`.
- **Exploitation** : `AdminUser`, `AuditLog`, `PricingRuleSet`, `FlatRate`.

Machine à états d'une course (`packages/shared`) : `CREATED → QUOTED → CONFIRMED → DISPATCHING → ASSIGNED → EN_ROUTE → ARRIVED → IN_PROGRESS → COMPLETED`, avec les issues `CANCELLED_BY_CLIENT`, `CANCELLED_BY_PARTNER`, `NO_SHOW`, `DISPUTED`, `REFUNDED` ; les transitions autorisées sont définies en un seul endroit et vérifiées.

## 4. Fonctionnalités par domaine

**Partenaires (API REST, spécification dans `docs/openapi.yaml`)** : devis à prix fixe (forfaits aéroport ou grille), réservation avec clé d'idempotence, annulation avec barème, notation, webhooks signés (`booking.confirmed`, `driver.assigned`, `driver.en_route`, `driver.arrived`, `ride.started`, `ride.completed`, `booking.cancelled`, `flight.delayed`, `flight.updated`), lien de suivi et photo du chauffeur.

**Prix** : moteur pur et testé (grille et forfaits), **échelle de prix chauffeur** (le prix proposé monte à l'approche de la mission, jusqu'au plafond), rémunération minimale de 9 € net par course, commission réduite si besoin.

**Dispatch** : offres successives par catégorie de véhicule et proximité, acceptation exclusive atomique (un seul gagnant), chevauchements interdits, reprise par un autre chauffeur, attribution manuelle par l'opérateur.

**Chauffeurs** : connexion par code SMS à usage unique (limites d'essais et de renvois), documents obligatoires avec échéances et rappels (30, 14, 7, 1 jours, mise hors ligne à l'expiration), critères véhicule à l'admission (âge, places, portes, dimensions, puissance, avec exemptions hybrides, électriques et collection), identité de l'exploitant et justificatif de réservation, revenus par période avec rendement par heure de mission et export CSV, signalement d'incident (alerte à l'équipe).

**Confiance et sécurité** : selfie de référence validé par un humain, selfie de prise de service (valable 12 h), vérifications aléatoires pendant le service, **aucune reconnaissance faciale automatique** (donnée biométrique), pénalités progressives pour restitution de mission, appel à un **sauveteur** (chauffeur d'élite qui reprend une mission, avec prime), sanctions de récidive avec examen humain.

**Voyageur** : lien secret de suivi (192 bits) envoyé par SMS et e-mail, page de suivi bilingue, photo du chauffeur seulement avec **son consentement** (révocable, journalisé), alertes SMS « chauffeur arrivé » et « vol retardé ».

**Administration** : comptes nominatifs avec rôles (administrateur, régulateur), verrouillage après échecs, journal d'audit, tableau de missions, alertes (incidents en tête), performance, espace société (flotte, relevés, CSV).

## 5. Sécurité

- Authentification : clés API hachées (partenaires, sociétés), jetons HMAC signés (chauffeurs, back-office), mots de passe scrypt avec règles (longueur, pas d'identifiant), verrouillage après 5 échecs, limitation des demandes de code.
- Webhooks : signature HMAC-SHA256 horodatée ; reprise avec délais croissants.
- Données : photos limitées à 400 Ko (JPEG ou PNG vérifiés), selfies de service purgés après 30 jours, journal d'audit, séparation des vues par rôle (le chauffeur ne voit pas la marge de la plateforme).
- Production : refus de démarrer sans `TOKEN_SECRET` robuste, sans code de développement, et avec `CORS_ORIGINS=*` (réservé à la démonstration locale).
- Page de suivi : jeton non devinable, jamais le téléphone ni le nom de famille du chauffeur, ni le prix, ni la position en direct.

## 6. Qualité et tests

- **Vérifié par les tests automatiques (dernier passage complet)** : 207 tests de l'API (parcours de bout en bout sur une vraie base PostgreSQL), 13 tests de l'application chauffeur, 3 tests de la page de suivi, tests des paquets ; vérification de types sans erreur sur l'API, l'application, le back-office et la page de suivi.
- **Vérifié par essai direct** : parcours de connexion et d'accueil de l'application dans un navigateur (Playwright), construction et démarrage de l'image Docker de la page de suivi, validation du compose de production (`docker compose config`) et du Caddyfile, sauvegarde et restauration de la base, génération du projet Android.
- Démonstration locale : `pnpm demo` lance l'API, l'application, le back-office et la page de suivi (essayé sous Linux).

## 7. Déploiement

Pile de production sur un seul serveur (`infra/docker-compose.prod.yml`, guide dans `docs/DEPLOIEMENT.md`). Trois noms de domaine (API, back-office, suivi) et des secrets à fournir. Construction Android : workflow GitHub Actions et profil EAS préparés.

## 8. Limites et risques connus (honnêtement)

**Non vérifié en conditions réelles**
- Les adaptateurs Twilio, Resend, OSRM, Flightradar24 et Stripe n'ont jamais été essayés contre un vrai compte.
- Le déploiement de production n'a pas été lancé de bout en bout (pas de serveur ni de domaine).
- L'APK Android n'a jamais été compilé (pas de SDK Android dans l'environnement de développement) ; la génération du projet fonctionne, la compilation est inconnue.
- L'application n'a pas été testée sur un vrai téléphone avec Expo Go ; elle dépend du SDK 52 d'Expo, alors que l'application Expo Go du Play Store suit des versions plus récentes (message « incompatible SDK »).
- La caméra n'a été essayée que par le sélecteur de fichier d'un navigateur.
- Les essais sous Windows n'ont pas pu être faits ici : plusieurs difficultés rencontrées par l'utilisateur (chemin du projet, `pnpm`, pare-feu, anciens serveurs actifs) l'ont été sur sa machine.

**Dette technique et choix de prototype**
- Les selfies sont stockés dans la base de données ; un stockage objet chiffré avec politique de conservation est nécessaire avant une vraie production.
- Pas de haute disponibilité (une instance), pas de supervision ni d'alerte, pas de copie des sauvegardes hors du serveur.
- Pas de chaîne de publication de l'application sur les boutiques ; l'APK est signé avec la clé de débogage.
- Pas de position en direct du chauffeur ni de carte pour le voyageur ; pas de « STOP » pour les SMS ; les alertes d'incident n'arrivent que sur le tableau de bord (ni SMS, ni push, ni astreinte).
- Le rendement horaire ne compte que le temps de mission (de la mise en route à la fin de la course).
- Aucun paiement ni facturation réels ; Stripe est seulement modélisé.
- Le site de réservation client (phase 2) n'existe pas ; seule la page de suivi existe.

**Points juridiques à faire valider par un professionnel** (je ne suis pas juriste)
- Statut d'exploitant ou d'intermédiaire et modèle société-chauffeurs (registre des exploitants).
- Règles véhicule : issues de la fiche Service-Public (vérifiée le 12/08/2026), pas des textes de loi.
- Pénalités supérieures à 100 % (clause pénale), suspensions automatiques (article 22 du RGPD), consentement et durée de conservation des photos, mention de l'envoi de SMS et e-mails aux voyageurs.

## 9. Suites recommandées
1. Vérifier le nom (marque INPI et EUIPO, domaine, boutiques d'applications).
2. Lancer un **pilote** : serveur de pré-production, un vrai numéro SMS, 2 ou 3 chauffeurs volontaires, un partenaire de test.
3. Essayer chaque adaptateur externe avec un vrai compte, un à un.
4. Compiler et tester l'APK, puis préparer la publication (comptes développeurs, clé de signature, fiches).
5. Mettre en place la supervision, les sauvegardes hors serveur et le stockage objet des documents.
6. Faire relire les points juridiques par un avocat avant l'ouverture publique.
