# Pilote CliCab

## Test de charge reproductible

Sur une base PostgreSQL de test dédiée et migrée, lancer `pnpm -F @vtc/api exec vitest run src/flow.test.ts -t 'rush de 100'`. Le test réinitialise les données de sa base. Il crée 100 réservations en lots de 10 par défaut (variable `RUSH_CONCURRENCY`, de 1 à 100), vérifie les rejeux idempotents, déroule les différents résultats de course et contrôle les boîtes chauffeur et les alertes de la tour de contrôle. Les temps p95 concernent la machine et la charge du test. Les fournisseurs de messagerie sont simulés.

L'alarme de la tour de contrôle sonne pour un incident urgent ouvert, une mission sans chauffeur ou à risque et un vol annulé. Elle dépend d'un onglet ouvert et de l'autorisation de lecture audio du navigateur. Les sons de l'application chauffeur reposent sur l'interrogation de l'API lorsque l'application est ouverte. Un essai sur téléphone physique complète les tests automatiques.

Pour le test navigateur, démarrer le back-office sur le port 5301 avec `NEXT_PUBLIC_API_URL=http://127.0.0.1:5300`. Installer `playwright-core` dans un répertoire d'outils et indiquer son dossier `node_modules` via `NODE_PATH`, puis lancer `node scripts/ci/backoffice-browser.cjs`. Le script intercepte l'API avec des données simulées, lit le vrai fichier audio dans Chromium et vérifie le parcours opérateur. `CHROMIUM_PATH` permet de choisir l'exécutable Chromium.

## Règlement du premier partenaire

Le mode proposé pour le pilote est un règlement mensuel par facture, à faire confirmer par le partenaire. Dans le back-office, l'onglet Partenaires exporte les courses réelles terminées et annulées et les montants dus par le partenaire et au chauffeur. La même référence interne `R-…` permet de faire le rapprochement. Les lignes de mise en commun et les pénalités restent dans le relevé de la société. Le CSV sert de pièce de rapprochement. La facture, les avoirs, les encaissements et les virements restent traités dans l'outil comptable du pilote.

## Conditions du premier essai réel

- Utiliser un tag d'image correspondant au commit validé pour le VPS et conserver une sauvegarde hors serveur.
- Vérifier la réception des SMS Infobip par un numéro de test et la réception des alertes d'exploitation dans le canal choisi.
- Rejouer la course avec un chauffeur sur téléphone physique, puis tester le client absent, un incident urgent et la reprise après perte de réseau.
- Renseigner l'identité de l'éditeur et les coordonnées de l'hébergeur dans les mentions légales. Faire valider par le responsable de traitement les durées et modalités de suppression des selfies, justificatifs et photos avant publication.
