# Déploiement (pré-production, un seul serveur)

Ce guide décrit ce qui a été **vérifié** et ce qui reste à faire. L'API, le back-office et la page de suivi voyageur ont été construits en images Docker
(la page de suivi a aussi été lancée : réponse 200, en-têtes de confidentialité, utilisateur non root, contrôle de santé « healthy ») ; le script de sauvegarde a été essayé
(copie, purge des anciennes copies, échec géré, restauration dans une base jetable). La pile complète `docker-compose.prod.yml` n'a **pas** été lancée de bout en bout
(pas de domaine ni de serveur public dans l'environnement de développement). Le fichier compose et le `Caddyfile` sont validés par `docker compose config` et `caddy validate`.

## Prérequis
- Un serveur Linux avec Docker + Docker Compose, ports 80 et 443 ouverts.
- Quatre noms pointant vers ce serveur : `api.`, `admin.` et `suivi.` + votre domaine, plus le domaine lui-même (site vitrine, `apps/site`) et son `www.`.

## Mise en route
```bash
cp infra/.env.prod.example infra/.env.prod      # puis renseigner les secrets (openssl rand -hex 32 …)
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod up -d --build
docker compose -f infra/docker-compose.prod.yml exec -e ADMIN_PASSWORD='phrase de passe longue' api \
  node dist/cli/create-admin.js vous@exemple.fr "Votre Nom"
```
Le compose refuse de démarrer si `POSTGRES_PASSWORD`, `TOKEN_SECRET`, `ADMIN_DOMAIN` ou `TRACK_DOMAIN` manquent. Les migrations s'appliquent au démarrage de l'API.
Le certificat HTTPS est obtenu automatiquement par Caddy.

## Santé
- `GET /health` : le processus répond. `GET /ready` : la base est joignable (utilisé par le contrôle de santé Docker).

## Sauvegardes
Le service `backup` du compose sauvegarde la base toutes les 24 h (`BACKUP_INTERVAL_HOURS`) dans le volume `backups` (format `pg_dump -Fc`) et supprime les copies de plus de 14 jours (`BACKUP_RETENTION_DAYS`).
**Ce n'est pas suffisant seul** : ces copies sont sur le même serveur que la base. Copiez-les régulièrement ailleurs (autre serveur, stockage objet chiffré), par exemple :
```bash
docker compose -f infra/docker-compose.prod.yml cp backup:/backups ./sauvegardes-$(date +%F)
```
Le service `backup-check` restaure automatiquement la dernière sauvegarde dans une base temporaire chaque semaine et alerte en cas d'échec (voir [MISE_EN_LIGNE.md](MISE_EN_LIGNE.md)).

Restauration (à **tester** avant tout trafic réel) :
```bash
docker compose -f infra/docker-compose.prod.yml stop api
docker compose -f infra/docker-compose.prod.yml cp ./vtc-AAAAMMJJ-HHMMSS.dump db:/tmp/restore.dump
docker compose -f infra/docker-compose.prod.yml exec db pg_restore -U vtc -d vtc --clean --if-exists /tmp/restore.dump
docker compose -f infra/docker-compose.prod.yml start api
```
La sauvegarde contient les selfies et les données personnelles des chauffeurs : la protéger et la purger selon la politique de conservation.

## Mise à jour / retour arrière
`git pull && docker compose ... up -d --build`. Les migrations sont « en avant » : pour revenir en arrière, restaurer la sauvegarde d'avant la mise à jour.

## Liste de contrôle avant ouverture
- [ ] `TOKEN_SECRET` unique et secret ; `ADMIN_TOKEN` vide (ou secret robuste) ; `DRIVER_DEV_OTP` **absent** (refusé au démarrage).
- [ ] Fournisseur SMS configuré et testé avec un vrai numéro (adaptateurs OVHcloud et Twilio non essayés en réel).
- [ ] Routage : héberger OSRM (ne pas utiliser le serveur de démonstration public) ou rester sur l'estimation.
- [ ] Sauvegardes copiées hors du serveur et restauration testée sur votre serveur.
- [ ] `TRACK_DOMAIN` ouvert et le lien reçu par SMS pointe bien vers `https://suivi.…` (faire une réservation de test avec une clé réelle ; les clés de test n'envoient rien).
- [ ] Surveillance : alerte si `/ready` échoue ; journaux conservés.
- [ ] Contrat, assurance et statut juridique validés (voir `CAHIER_DES_CHARGES.md` §9).

## Non couvert
Haute disponibilité (une seule instance), publication de l'application chauffeur (App Store, Google Play : aucune chaîne EAS/Expo en place), stockage objet des documents et des selfies (aujourd'hui dans la base), paiements (Stripe), e-signature, notifications push, métriques/alertes.

## Variante « VPS Hostinger, sans terminal » (`infra/docker-compose.vps.yml`)

Quand on n'a pas de terminal sur le serveur, le gestionnaire Docker de hPanel (VPS > Gestionnaire Docker) accepte **un seul fichier compose**. `infra/docker-compose.vps.yml` est autonome : la configuration Caddy et le script de sauvegarde y sont intégrés. **hPanel ne construit pas d'images** (constaté : « No such image: clicab-api:latest ») : la CI GitHub construit les trois images après des tests verts et les publie sur `ghcr.io/sniper4194` (`clicab-api`, `clicab-backoffice`, `clicab-suivi`, étiquette `pilote` + empreinte du commit). Les paquets sont **publics** (choix de l'utilisateur : le VPS ne peut pas s'authentifier) ; aucun secret n'y figure. L'adresse de l'API est intégrée aux pages web à la construction : `https://api.clicab.fr` (variable de dépôt GitHub `API_URL` pour la changer).

1. **Paquets publics, une seule fois** : après la première publication, sur GitHub > votre profil > Packages, pour `clicab-api`, `clicab-backoffice` et `clicab-suivi` : Package settings > Change visibility > Public.
2. **Créer le projet** (nom `clicab`) en collant le contenu de `infra/docker-compose.vps.yml`, et renseigner les variables d'environnement dans hPanel (jamais dans le fichier) :
   - `IMAGE_TAG` (facultatif) : `pilote` par défaut ; l'empreinte d'un commit pour revenir à une version précise
   - `API_DOMAIN`, `ADMIN_DOMAIN`, `TRACK_DOMAIN` (les trois enregistrements DNS « A » doivent pointer vers l'IP du VPS)
   - `POSTGRES_PASSWORD`, `TOKEN_SECRET` (`openssl rand -hex 32`), `ADMIN_TOKEN` (temporaire, voir ci-dessous)
   - pour que les chauffeurs puissent se connecter : `SMS_PROVIDER=ovh`, `OVH_APP_KEY`, `OVH_APP_SECRET`, `OVH_CONSUMER_KEY`, `OVH_SMS_SERVICE` (et `OVH_SMS_SENDER` une fois l'expéditeur validé par OVHcloud) ; ou Twilio : `SMS_PROVIDER=twilio`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` ; ou Infobip : `SMS_PROVIDER=infobip`, `INFOBIP_BASE_URL` (adresse personnelle affichée dans le portail), `INFOBIP_API_KEY`, `INFOBIP_FROM`. **Sans fournisseur SMS, la connexion chauffeur répond 501.**
3. Le premier démarrage télécharge les images (quelques minutes). Pour une nouvelle version : attendre la CI verte, puis « Mettre à jour » le projet dans hPanel. Caddy obtient ensuite les certificats HTTPS tout seul.
4. **Premier compte administrateur** : avec `ADMIN_TOKEN` défini, créez-le par l'API, puis **retirez `ADMIN_TOKEN`** du projet et mettez le projet à jour (le jeton de service donne tous les droits).
5. Le site vitrine reste sur l'hébergement web (clicab.fr) : cette variante n'en a pas besoin.

Régénérer le fichier après une modification : `node infra/make-vps-compose.mjs`.

**Non vérifié** : la construction des images depuis l'adresse GitHub avec jeton n'a pas pu être essayée depuis l'environnement de développement. Les fichiers sont validés par `docker compose config` (le contenu intégré est identique aux originaux).
