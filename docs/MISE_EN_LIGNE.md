# Mise en ligne et essai en conditions réelles

À suivre dans l'ordre. Chaque étape dit comment savoir qu'elle a réussi. Détails techniques : [DEPLOIEMENT.md](DEPLOIEMENT.md).
Les mots de passe, jetons et clés ne s'écrivent **que** dans hPanel ou dans votre bloc-notes : jamais dans le dépôt, jamais dans une conversation.

Déjà vérifié : le VPS (`76.13.255.155`) est allumé et vide ; `api`, `admin` et `suivi.clicab.fr` pointent vers lui.

## Étape 1. Jeton GitHub (lecture seule)
GitHub → photo de profil → **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
- Nom : `clicab-vps` ; expiration : 30 jours.
- Repository access : **Only select repositories** → `vtc_plateform_beta`.
- Permissions → Repository permissions → **Contents : Read-only**.
- **Réussi quand** : un jeton commençant par `github_pat_` s'affiche. Copiez-le dans le bloc-notes (il ne sera plus jamais affiché).

## Étape 2. Infobip (SMS)
Dans le portail Infobip :
- **Adresse personnelle de l'API** (« Base URL », du type `xxxxx.api.infobip.com`) : page d'accueil ou rubrique API.
- **Clé d'API** : Developers → API keys → créer une clé, la copier dans le bloc-notes.
- **Expéditeur** : en essai gratuit, Infobip impose souvent le sien ; laissez vide si vous ne savez pas.
- Essai gratuit : à notre connaissance, envois seulement vers le numéro enregistré à l'inscription, en nombre limité (à vérifier dans le portail).

## Étape 3. Lien d'alerte Discord (conseillé)
Discord : créez un salon `alertes-clicab` → roue dentée du salon → **Intégrations** → **Webhooks** → **Nouveau webhook** → **Copier l'URL du webhook**.

## Étape 4. Trois mots de passe aléatoires
Sur le PC, ouvrez **PowerShell** et lancez **3 fois** :
```
-join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Maximum 256) })
```
Notez les 3 résultats : n° 1 = `POSTGRES_PASSWORD`, n° 2 = `TOKEN_SECRET`, n° 3 = `ADMIN_TOKEN`.

## Étape 5. Créer le projet dans hPanel
1. hPanel → **VPS** → **Gestionnaire Docker** → nouveau projet, nom `clicab`.
2. Ouvrez https://github.com/sniper4194/vtc_plateform_beta/blob/claude/optimistic-maxwell-sagq8e/infra/docker-compose.vps.yml → bouton **Copy raw file** → collez **tout** dans hPanel.
3. Variables d'environnement :

| Variable | Valeur |
|---|---|
| `GIT_CONTEXT` | `https://JETON@github.com/sniper4194/vtc_plateform_beta.git#claude/optimistic-maxwell-sagq8e` (remplacez `JETON`) |
| `API_DOMAIN` | `api.clicab.fr` |
| `ADMIN_DOMAIN` | `admin.clicab.fr` |
| `TRACK_DOMAIN` | `suivi.clicab.fr` |
| `POSTGRES_PASSWORD` | mot de passe n° 1 |
| `TOKEN_SECRET` | mot de passe n° 2 |
| `ADMIN_TOKEN` | mot de passe n° 3 (temporaire : supprimé à l'étape 8) |
| `SMS_PROVIDER` | `infobip` |
| `INFOBIP_BASE_URL` | votre adresse `xxxxx.api.infobip.com` |
| `INFOBIP_API_KEY` | votre clé Infobip |
| `INFOBIP_FROM` | vide, ou l'expéditeur autorisé |
| `ERROR_WEBHOOK_URL` | l'URL Discord |
| `IDENTITY_CHECKS` | `0` (premier essai seulement) |
| `VEHICLE_RULES` | `0` (premier essai seulement) |

4. Lancez (Déployer). La construction prend plusieurs minutes.
- **Réussi quand** : tous les services sont « en cours d'exécution » et https://api.clicab.fr/health affiche `{"status":"ok"}`.
- Les certificats HTTPS sont demandés automatiquement au premier démarrage : une erreur de certificat pendant les premières minutes est normale.

## Étape 6. Vérifier les pages
- https://api.clicab.fr/health → `{"status":"ok"}`
- https://admin.clicab.fr → écran de connexion du back-office
- https://suivi.clicab.fr/candidature → formulaire de candidature

## Étape 7. Essai réel depuis le PC (vrai SMS)
Dans le dossier du projet, **PowerShell**, avec Node 20 ou plus (`node --version`) :
```
$env:ADMIN_TOKEN="mot de passe n° 3"
$env:GOLIVE_PHONE="votre numéro, ex. 0612345678"
$env:GOLIVE_ADMIN_EMAIL="votre e-mail"
$env:GOLIVE_ADMIN_PASSWORD="un mot de passe long, différent des autres"
node scripts/golive.mjs https://api.clicab.fr
```
Le script vérifie le serveur, crée votre compte administrateur, un chauffeur à **votre** numéro, vous envoie un **vrai SMS** (tapez le code reçu), valide des documents de test et crée deux missions.
- **Réussi quand** : la ligne « connexion par SMS réussie : le SMS fonctionne » s'affiche.
- **Si le SMS n'arrive pas** : vérifiez les 3 variables Infobip et les journaux du service `api` dans hPanel (le motif du refus d'Infobip y est écrit).

## Étape 8. Fermer la porte de service
hPanel : **supprimez la variable `ADMIN_TOKEN`**, puis mettez le projet à jour. Ce jeton donne tous les droits : il ne doit pas rester.
Ensuite, connexion au back-office (https://admin.clicab.fr) avec l'e-mail et le mot de passe de l'étape 7.

## Étape 9. Essai sur téléphone
1. Installez l'APK chauffeur (GitHub → Actions → « APK chauffeur » → dernier passage vert → Artifacts).
2. Écran de connexion → « Serveur » → `https://api.clicab.fr`.
3. Connexion avec votre numéro et le code reçu par SMS.
4. Radar : prenez une mission, passez « en route » puis « sur place ».
5. **Dehors, GPS activé** : photo-preuve « Client absent » ; au back-office, la mission affiche la preuve et sa distance au lieu de prise en charge.

## Étape 10. Remettre les contrôles et surveiller
- hPanel : `IDENTITY_CHECKS=1` et `VEHICLE_RULES=1` (ou supprimez ces deux variables), puis mise à jour.
- **Disponibilité** : UptimeRobot (gratuit) surveille https://api.clicab.fr/health toutes les 5 minutes.
- **Erreurs** : elles arrivent sur le salon Discord (un même message au plus une fois par 10 minutes).
- **Sauvegardes** : le service `backup-check` restaure la dernière sauvegarde dans une base temporaire chaque semaine ; résultat dans ses journaux (« contrôle ok »).
- **Copie hors du serveur** des sauvegardes : reste à organiser (voir [DEPLOIEMENT.md](DEPLOIEMENT.md)).

## Ce qui n'est pas encore vérifié
- La construction des images depuis GitHub avec jeton sur le VPS (testée seulement en local et dans la CI GitHub).
- L'envoi réel de SMS par Infobip (écrit d'après les exemples publiés, le site de documentation n'était pas joignable).
- L'alerte Discord réelle et celle du service `backup-check`.
- Aucune charge n'a été simulée.
