# CliCab TEST — environnement permanent Hostinger
## Architecture
Branche staging/clicab (inclut CRM/SAV et authentification hybride en cours de validation). Aucun déploiement automatique. CI publie uniquement staging-<SHA> sur les trois paquets GHCR après réussite des tests. Le tag pilote reste inchangé. APK séparé com.clicab.driver.test, nom CliCab TEST, serveur HTTPS api-test.clicab.fr imposé. APK de débogage destiné aux tests, pas Google Play. Une clé de débogage différente entre builds peut imposer la désinstallation de CliCab TEST (jamais de l'app de production) avant mise à jour.
## Installation sur un VPS séparé
Ne pas utiliser le VPS de production : ce compose réserve les ports 80/443. Choisir un deuxième VPS Linux Docker Compose v2 récent (support configs.content), sans commande de production, et avec un pare-feu SSH restrictif. Cette proposition peut entraîner un abonnement additionnel ; aucune commande de VPS n'a été passée.
1. Attendre que CI publie les 3 images portant le même staging-<SHA>, et que le job APK soit vert.
2. Dans DNS Hostinger, créer uniquement les trois nouvelles entrées A api-test, admin-test et suivi-test vers l'IPv4 du NOUVEAU VPS. Ne modifier aucune entrée existante. Si IPv6 utilisée, créer les AAAA correspondants seulement si elle est configurée. Utiliser DNS direct, sans proxy CDN pour le filtrage IP Caddy. Ouvrir 80/443 pour Caddy/ACME ; SSH réservé aux administrateurs.
3. Copier infra/docker-compose.staging.yml dans un dossier dédié (ex. /opt/clicab-staging/compose.yml) sur ce nouveau VPS, et infra/staging.env.example dans .env. Générer deux secrets hexadécimaux différents via openssl rand -hex 32. STAGING_SHA = SHA complet sans préfixe staging-. STAGING_ALLOWED_IPS = IP publiques exactes du PC et du téléphone, séparées par espaces (CIDR /32 ou /128). Jamais 0.0.0.0/0, ::/0 ou plages trop larges ; mettre à jour si IP change. chmod 600 .env. Ne pas réutiliser de secrets, de sauvegardes ni de comptes réels.
4. Dans ce dossier : docker compose config --quiet ; docker compose pull ; docker compose up -d ; docker compose ps. Si registre privé, docker login ghcr.io avec un jeton de lecture de paquets dédié (ne jamais le commiter). Vérifier la disponibilité et le certificat depuis une IP autorisée : curl -i https://api-test.clicab.fr/health. Depuis une autre IP, vérifier 403. Vérifier que PostgreSQL n'est pas exposé. Le réseau interne limite les accès sortants API ; pas d'intégrations payantes configurées.
5. Créer le premier admin de test via SSH (Bash, commande interactive, mot de passe distinct) :
```bash
read -rsp "Mot de passe administrateur TEST : " ADMIN_PASSWORD; echo
export ADMIN_PASSWORD
docker compose exec -e ADMIN_PASSWORD api node dist/cli/create-admin.js admin-test@example.invalid "Admin TEST"
unset ADMIN_PASSWORD
docker compose exec api node dist/cli/staging-seed.js
```
Se connecter sur https://admin-test.clicab.fr. Le chauffeur fictif a le numéro +447700900001 (format E.164). Ne pas importer les données de production.
## Tester sur Android
Dans GitHub Actions > APK CliCab TEST (préproduction), télécharger l'artifact clicab-test-apk du même commit, décompresser et installer l'APK. Le téléphone doit être sur une IP autorisée. Dans CliCab TEST, saisir +447700900001, choisir Activer mon compte, définir un mot de passe et demander le code. Le code est aléatoire et valable 5 min. Depuis SSH sur le VPS de TEST uniquement :
```bash
docker compose logs --since=5m api | grep 'SMS →'
```
Lire le dernier SMS simulé correspondant au chauffeur, le saisir dans l'application. Ne pas publier les journaux : ils contiennent les codes et des données de test. Aucun SMS réel ni email réel. Les e-mails simulés apparaissent par sujet dans les journaux ; l'envoi commercial CRM reste désactivé. Aucun webhook partenaire n'est livré. Pas de clé Google Maps dans l'APK TEST ; carte simplifiée/vide selon appareil. Les contrôles identité/véhicule sont désactivés uniquement dans ce compose de test.
Vérifier connexion sans SMS sur appareil connu, fermeture et réouverture, biométrie, nouvel appareil, révocation depuis back-office, récupération. Tester CRM/SAV et les missions avec des données fictives. Un 403 réseau signifie souvent IP non autorisée.
## Mises à jour
Utiliser une version dont CI et APK sont validés, sauvegarder la base staging (pg_dump), modifier uniquement STAGING_SHA dans .env staging, docker compose pull puis docker compose up -d. Ne jamais lancer down -v. Une migration peut rendre un retour arrière incompatible, restaurer la sauvegarde staging si nécessaire. Les mêmes trois images doivent utiliser le même SHA. Ne jamais appliquer les variables STAGING à la production.
## Limites
DNS, achat/configuration du VPS, déploiement et tests physiques ne sont pas effectués par le dépôt. Le filtrage IP doit être vérifié sur le serveur réel ; pas d'accès public. Pas de copie de production ni de test de livraison externe. Les logs OTP sont confidentiels, rotation limitée ; détruire les codes et données fictives selon une procédure de rétention. Tests à réaliser avec les appareils physiques ; les artefacts ne sont pas une preuve de bon fonctionnement réel.
