# Déploiement (pré-production, un seul serveur)

Ce guide décrit ce qui a été **vérifié** et ce qui reste à faire. L'API et le back-office ont été construits en images Docker et lancés
(migrations, `/ready`, utilisateur non root, contrôle de santé) ; la pile complète `docker-compose.prod.yml` n'a **pas** été lancée de bout en bout
(pas de domaine ni de serveur public dans l'environnement de développement). Le `Caddyfile` et le fichier compose ont été validés syntaxiquement.

## Prérequis
- Un serveur Linux avec Docker + Docker Compose, ports 80 et 443 ouverts.
- Deux noms de domaine (API et back-office) pointant vers ce serveur.

## Mise en route
```bash
cp infra/.env.prod.example infra/.env.prod      # puis renseigner les secrets (openssl rand -hex 32 …)
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod up -d --build
docker compose -f infra/docker-compose.prod.yml exec -e ADMIN_PASSWORD='phrase de passe longue' api \
  node dist/cli/create-admin.js vous@exemple.fr "Votre Nom"
```
Le compose refuse de démarrer si `POSTGRES_PASSWORD` ou `TOKEN_SECRET` manquent. Les migrations s'appliquent au démarrage de l'API.
Le certificat HTTPS est obtenu automatiquement par Caddy.

## Santé
- `GET /health` : le processus répond. `GET /ready` : la base est joignable (utilisé par le contrôle de santé Docker).

## Sauvegardes (à mettre en place avant tout trafic réel)
```bash
docker compose -f infra/docker-compose.prod.yml exec -T db pg_dump -U vtc vtc | gzip > sauvegarde-$(date +%F).sql.gz
```
À planifier (cron) et à copier hors du serveur ; **tester la restauration**. Rien n'est automatisé pour l'instant.

## Mise à jour / retour arrière
`git pull && docker compose ... up -d --build`. Les migrations sont « en avant » : pour revenir en arrière, restaurer la sauvegarde d'avant la mise à jour.

## Liste de contrôle avant ouverture
- [ ] `TOKEN_SECRET` unique et secret ; `ADMIN_TOKEN` vide (ou secret robuste) ; `DRIVER_DEV_OTP` **absent** (refusé au démarrage).
- [ ] Fournisseur SMS configuré et testé avec un vrai numéro (adaptateur Twilio non essayé en réel).
- [ ] Routage : héberger OSRM (ne pas utiliser le serveur de démonstration public) ou rester sur l'estimation.
- [ ] Sauvegardes planifiées et restauration testée.
- [ ] Surveillance : alerte si `/ready` échoue ; journaux conservés.
- [ ] Contrat, assurance et statut juridique validés (voir `CAHIER_DES_CHARGES.md` §9).

## Non couvert
Haute disponibilité (une seule instance), stockage objet des documents chauffeurs, paiements (Stripe), e-signature, notifications push, métriques/alertes.
