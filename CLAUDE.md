# CliCab : instructions pour Claude

Plateforme VTC à prix fixe : partenaires (agences, plateformes de réservation) → chauffeurs et sociétés VTC → voyageurs. Phase pilote, **pas encore en ligne** (le VPS est vide). Détails : `README.md`, `docs/`.

## Comment travailler avec l'utilisateur
- **Répondre en français.** Phrases simples : l'utilisateur est chauffeur VTC expérimenté, pas développeur.
- **Dire ce qui est vérifié et ce qui ne l'est pas**, sans enrober. Ne jamais inventer de chiffres, de statistiques ni de conformité légale. Je ne suis pas juriste : les textes juridiques sont des modèles à faire valider.
- **Ne pas décider à sa place** des valeurs métier (prix, commissions, seuils). Proposer, marquer « à confirmer », et le dire.
- **Ne pas changer le design sans demander.** L'identité est celle de l'application : style affiche rétro (voir « Design »).
- Transparence envers les chauffeurs. Pas de plagiat des concurrents (ni textes, ni visuels, ni slogans). Exemples : prénoms et noms **variés** (pas seulement maghrébins).
- Commits et envois sur la branche de travail **`claude/optimistic-maxwell-sagq8e`**. Pas de pull request ni de fusion vers `main` sans demande explicite.
- Les secrets (mots de passe, jetons, clés d'API) ne vont jamais dans le dépôt ni dans la conversation : l'utilisateur les saisit dans hPanel / GitHub.

## Carte du dépôt (monorepo pnpm)
| Dossier | Rôle |
|---|---|
| `apps/api` | NestJS 10 + Prisma 5 + PostgreSQL (tout le métier) |
| `apps/driver-app` | Application chauffeur, Expo SDK 52 / React Native 0.76 (aussi en web) |
| `apps/backoffice` | Tour de contrôle et espace société, Next.js 15 (port 3001) |
| `apps/web-booking` | Page de suivi voyageur, formulaire de candidature et pages de réservation clé en main `/reserver/{partenaire}`, Next.js 15 (port 3002) |
| `apps/site` | Site vitrine **statique** (clicab.fr), généré, hébergé chez Hostinger |
| `packages/pricing`, `packages/shared` | Moteur de prix, types partagés (à construire avant l'API : `pnpm setup:build`) |
| `infra/` | Docker Compose, Caddy, sauvegardes, `docker-compose.vps.yml` (généré par `make-vps-compose.mjs`) |
| `scripts/` | `demo.mjs` (démo locale), `golive.mjs` (essai réel), `setup-env.mjs` |
| `docs/` | Cahier des charges, déploiement, mise en ligne, recrutement, OpenAPI, politiques |
| `marketing/` | Visuels et plan de campagne (`node marketing/generate.cjs`) |

## Commandes
```bash
pnpm install
pnpm setup:env && pnpm setup:build   # fichiers .env, paquets partagés, client Prisma
pnpm demo                            # tout en local : API 3000, app web 8081, back-office 3001, suivi 3002
pnpm test | pnpm typecheck | pnpm build
pnpm -F @vtc/api test                # tests de l'API (base PostgreSQL « vtc_test » requise)
pnpm -F @vtc/api exec prisma migrate deploy
```
Démo : chauffeur `06 00 00 00 01` code `000000` ; admin `demo@clicab.local` / `Bureau-Soleil-2026!`.

## Avant de dire « c'est fait »
1. `pnpm -F @vtc/api test`, `pnpm -F @vtc/driver-app test`, `pnpm -F @vtc/web-booking test`, `pnpm -r typecheck` : tous verts.
2. **Chaîner avec `&&`, jamais `;`** : ne pas commiter après un test en échec. **Attention aux tubes** : `pnpm test | grep …` renvoie le code de `grep`, pas celui des tests ; commencer par `set -o pipefail` (un commit a été fait par erreur avec un test rouge).
3. **Après chaque envoi, vérifier la CI GitHub** (workflow « CI » et « APK chauffeur ») et corriger si elle est rouge. Une CI rouge est restée inaperçue pendant des heures.
4. Un changement d'interface se vérifie dans un vrai navigateur (Playwright) avec le vrai serveur, pas seulement par typecheck.
5. L'utilisateur est sous **Windows** : ce qui marche sous Linux peut casser là-bas. Dire explicitement ce qui n'a pas été essayé sur son environnement.
6. Toute erreur annoncée comme corrigée doit l'être par une cause **démontrée**, pas supposée (une hypothèse fausse sur la carte Google a été livrée puis annulée).

## Pièges connus
- **PostgreSQL du bac à sable s'arrête** : `pg_ctlcluster 16 main start`, puis exporter `DATABASE_URL`. Une série de tests soudain tous en échec = base arrêtée.
- **React 19 (Next) et React 18 (Expo)** cohabitent : l'app chauffeur importe ses types React explicitement (`import type { ReactNode } from "react"`) et fixe `typeRoots`. Ne pas utiliser `React.ReactNode` global.
- **Pas de hooks fournis par les modules Expo** (ex. `useCameraPermissions`) : sous Windows + pnpm ils chargent une seconde copie de React et plantent (`reading 'useRef'`). Utiliser les fonctions directes (`Camera.requestCameraPermissionsAsync`).
- **Ordre des contrôleurs Nest** : `driver/rides/:id/proofs` doit être enregistré avant la route générique `driver/rides/:id/:action`.
- Une table sans clé étrangère vers `Ride`/`Driver` n'est pas vidée par `TRUNCATE … CASCADE` des tests : relier les tables ou les ajouter à la liste.
- Les tests qui simulent un filtre ou un service doivent **restaurer** la simulation (`mockRestore`), sinon la suite suivante se bloque.
- Corps de requête limité à 1 Mo (photos : 650 Ko décodés au plus). `prisma generate` avant `pnpm -r build`.
- **hPanel ne construit pas d'images** (« No such image ») : la CI publie `ghcr.io/sniper4194/clicab-{api,backoffice,suivi}:pilote` (paquets publics) ; le VPS les télécharge. Aucune tabulation dans le fichier VPS.
- `docker-compose.vps.yml` est **généré** : modifier `docker-compose.vps.template.yml` puis `node infra/make-vps-compose.mjs`.
- Site statique : `.htaccess` (Apache/LiteSpeed) sans redirection HTTPS (Hostinger la gère) ; HSTS à passer de 1 jour à 1 an une fois vérifié.

## Conventions
- TypeScript strict. Validation des entrées avec `zod`. Un test à côté du code (`*.test.ts`). Migrations Prisma datées (`apps/api/prisma/migrations`).
- Textes affichés à l'utilisateur en français. Les commentaires expliquent le **pourquoi**.
- **Données personnelles minimales** : on ne conserve ni le relevé de permis (RII), ni le nombre de points, ni le casier judiciaire ; seulement le résultat du contrôle. Candidatures refusées anonymisées après 180 jours.
- Aucune décision automatique sur une personne : l'outil liste, un humain décide.
- Seuils et montants métier : **variables d'environnement** avec valeur par défaut (voir `.env.example`), jamais en dur sans option.

## Design (à respecter)
Style affiche rétro : ciel `#8fd0f5`, crème `#f5eedd`, bleu nuit `#0b2a4a`, encre `#14172b`, jaune `#f7b30a`, rouge `#ee2a14`. Polices Rozha One, Alfa Slab One, Anton, Kaushan Script. Cartes crème, bord encre de 3 px, ombre portée dure, pastilles. Nom de marque : **CliCab** (pas « ClicCab » ni « Étoile »). La disponibilité de la marque n'est pas vérifiée.

## Valeurs métier choisies par Claude, à faire confirmer
Van : coefficient 1,7, forfaits 95 € (CDG) et 85 € (Orly), commission réduite de 5 points (15 %). Prime électrique : 3 % du prix client (`ECO_BONUS_PERCENT`), prélevée sur la commission. Recrutement : 8 points de permis, français 60/100, anglais B1, éthique 70/100, codes de parrainage 3 par chauffeur. Planning : 10 h de mission maximum sur 24 h, retour à 3 km et 2 h, point de rendez-vous à 500 m. Garantie : alerte « à risque » 3 h avant la prise en charge sans chauffeur (`GUARANTEE_ALERT_MIN`). Échange de missions sans pénalité jusqu'à 48 h avant (`SWAP_MIN_HOURS`). Objet oublié signalable 7 jours (`LOST_ITEM_DAYS`) ; frais de restitution non définis. Prime de parrainage 1 € sur les 10 premières courses du filleul, **désactivée** (`REFERRAL_REWARD_ENABLED`) jusqu'à validation juridique. Mise en commun entre sociétés : jusqu'à 24 h avant, part reversée 0 % (`POOL_MIN_HOURS`, `POOL_SHARE_PERCENT`). Page de réservation clé en main : trajets entre l'adresse du partenaire et une liste d'aéroports et de gares (`HUBS` dans `apps/api/src/hosted.ts`, coordonnées approximatives **à vérifier**), code d'accès recommandé. Bilan carbone : aucun facteur par défaut (`CARBON_FACTOR_*`, à relever dans la Base Empreinte ADEME). Barème de pénalités provisoire. Revenu minimal 9 € net par course (source Service-Public, à revérifier).

## Jamais essayé en réel
SMS (Twilio, OVHcloud, Infobip), routage OSRM, suivi de vol, déploiement complet sur le VPS, photo-preuve sur un vrai téléphone avec GPS, restauration d'une sauvegarde sur le VPS. **Non implémenté** : notifications push, envoi de documents depuis l'application, paiement et versements (Stripe), factures sociétés, position en direct du chauffeur pour le voyageur, comptes multiples par société, pagination des listes.

## Feuille de route (ordre fixé par l'utilisateur)
1. Mise en ligne et essai réel : code prêt (`docs/MISE_EN_LIGNE.md`, `scripts/golive.mjs`) ; **attend** jeton GitHub, compte SMS, canal d'alerte, lancement dans hPanel. 2. Notifications push (nécessite un projet Firebase). 3. Envoi des documents depuis l'application. 4. Paiement, versements, facturation des sociétés. 5. Validation juridique et marque. 6. Position en direct voyageur, comptes multiples société, pagination.

## Méthode par fonction
Plan court → tests d'abord (API) → code → relecture → contrôle sécurité si données personnelles ou authentification → tests + typecheck → envoi → **CI vérifiée** → compte rendu honnête (fait / vérifié / non vérifié).

## Hébergement
Hostinger : site clicab.fr (hébergement web, déploiement par archive zip via le connecteur) ; VPS KVM 2 (`76.13.255.155`, Ubuntu) pour l'API, le back-office et le suivi (sous-domaines `api`, `admin`, `suivi`). Pas de terminal sur le VPS : tout passe par le gestionnaire Docker de hPanel.
