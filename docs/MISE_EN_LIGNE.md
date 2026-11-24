# Mise en ligne et essai en conditions réelles

À suivre dans l'ordre. Chaque étape dit comment savoir qu'elle a réussi. Détails techniques : [DEPLOIEMENT.md](DEPLOIEMENT.md).

## 1. Préparer (une fois)
- [ ] **Jeton GitHub en lecture seule** : GitHub, Settings, Developer settings, Fine-grained tokens. Dépôt `vtc_plateform_beta` uniquement, permission *Contents : Read-only*, 30 jours.
- [ ] **Compte SMS** : Twilio ou OVHcloud (voir [DEPLOIEMENT.md](DEPLOIEMENT.md)). Sans lui, personne ne peut se connecter à l'application.
- [ ] **Lien d'alerte** (facultatif mais fortement conseillé) : créez un canal Discord ou Slack dédié aux alertes, puis un « webhook entrant » (Discord : Paramètres du canal, Intégrations, Webhooks, Nouveau webhook, Copier l'URL). Ce lien est `ERROR_WEBHOOK_URL`.
- [ ] **DNS** : les enregistrements `A` de `api`, `admin` et `suivi` pointent vers l'adresse IP du VPS. Vérification : `nslookup api.clicab.fr`.

## 2. Lancer le projet (hPanel)
1. hPanel, VPS, Gestionnaire Docker, nouveau projet `clicab`. Collez `infra/docker-compose.vps.yml`.
2. Variables d'environnement : `GIT_CONTEXT`, `API_DOMAIN`, `ADMIN_DOMAIN`, `TRACK_DOMAIN`, `POSTGRES_PASSWORD`, `TOKEN_SECRET`, `ADMIN_TOKEN` (temporaire), `ERROR_WEBHOOK_URL`, et le SMS (`SMS_PROVIDER` + identifiants).
3. **Pour le premier essai seulement** : `IDENTITY_CHECKS=0` et `VEHICLE_RULES=0` (sinon il faut un selfie validé et une fiche véhicule complète avant de passer en ligne). À remettre à `1` ensuite.
4. Lancez et attendez : la construction des trois images prend plusieurs minutes.
- **Réussi quand** : tous les services du projet sont « en cours d'exécution » et `https://api.clicab.fr/health` répond `{"status":"ok"}` dans un navigateur.

## 3. Essai réel (depuis votre PC)
Dans le dossier du projet, avec Node 20 ou plus (`node --version`) :
```bash
set ADMIN_TOKEN=<la valeur de ADMIN_TOKEN>
set GOLIVE_PHONE=<votre numéro, ex. 0612345678>
set GOLIVE_ADMIN_EMAIL=<votre e-mail>
set GOLIVE_ADMIN_PASSWORD=<un mot de passe long, sans votre e-mail dedans>
node scripts/golive.mjs https://api.clicab.fr
```
(PowerShell : `$env:ADMIN_TOKEN="..."` à la place de `set`.) Le script vérifie le serveur, crée votre compte administrateur, un chauffeur à **votre** numéro, vous envoie un **vrai SMS** (tapez le code reçu), valide ses documents de test et crée deux missions.
- **Réussi quand** : la ligne « connexion par SMS réussie : le SMS fonctionne » s'affiche.
- **Si le SMS n'arrive pas** : vérifiez `SMS_PROVIDER` et les identifiants, puis les journaux du service `api` dans hPanel. Compte d'essai Twilio : seuls les numéros vérifiés reçoivent des SMS.

## 4. Fermer la porte de service
Dans hPanel, **supprimez la variable `ADMIN_TOKEN`** et mettez le projet à jour. Ce jeton donne tous les droits : il ne doit pas rester. Ensuite, on se connecte au back-office (`https://admin.clicab.fr`) avec le compte créé à l'étape 3.

## 5. Essai sur téléphone
1. Application chauffeur : sur l'écran de connexion, touchez « Serveur », saisissez `https://api.clicab.fr`.
2. Connexion avec votre numéro et le code reçu par SMS.
3. Radar : prenez une mission, passez « en route » puis « sur place ».
4. **Dehors, avec le GPS** : photo-preuve « Client absent » ; au back-office, la mission affiche la preuve avec sa distance au lieu de prise en charge.
5. Page de suivi voyageur et back-office : ouvrez-les aussi sur le téléphone.

## 6. Surveillance (à garder en place)
- **Disponibilité** : un service gratuit comme UptimeRobot (uptimerobot.com) surveille `https://api.clicab.fr/health` toutes les 5 minutes et vous écrit si le serveur ne répond plus.
- **Erreurs** : l'API (erreurs 5xx), les tâches de fond et les plantages de l'application chauffeur arrivent sur votre lien d'alerte (`ERROR_WEBHOOK_URL`). Un même message n'est envoyé qu'une fois par 10 minutes.
- **Sauvegardes** : le service `backup-check` restaure la dernière sauvegarde dans une base temporaire chaque semaine et vous alerte en cas d'échec. Résultat visible dans ses journaux (« contrôle ok »).
  Pour le déclencher tout de suite : redémarrez ce service dans hPanel ; le premier contrôle a lieu environ une heure après le démarrage.
- **Copie hors du serveur** des sauvegardes : reste à organiser (voir [DEPLOIEMENT.md](DEPLOIEMENT.md)) : tant qu'elles sont sur le même serveur, une panne du VPS les emporte avec la base.

## Ce qui n'est pas encore vérifié
- La construction des images depuis l'adresse GitHub avec jeton sur le VPS (testée seulement en local et dans la CI GitHub).
- Les envois réels de SMS (Twilio, OVHcloud) : écrits d'après leur documentation, jamais essayés.
- L'envoi d'alerte par le service `backup-check` (HTTPS depuis le conteneur Alpine) : la logique est testée, pas l'appel réseau réel.
- Aucune charge n'a été simulée.
