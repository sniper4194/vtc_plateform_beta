# Plan de tests CLI-P2-001

La phase 1 compte 18 scénarios déclarés validés dans le cadrage, sur TEST à la référence `43bfbb16403f873bc9c45fc891cfec9193366ac8`. Les cas ci-dessous vérifient la modification locale sur des données fictives.

| Cas | Vérification attendue | Couverture automatisée |
|---|---|---|
| 1 | Case cochée, compte nominatif et montant convenu donnent une attribution | `scripts/ci/backoffice-browser.cjs`, `apps/api/src/flow.test.ts` |
| 2 | Action désactivée sans confirmation et après changement de chauffeur ou de prix | `scripts/ci/backoffice-browser.cjs` |
| 3 | L’API refuse une déclaration absente, fausse, nulle ou d’un autre type, ainsi qu’un montant absent | `flow.test.ts` |
| 4 | Une trace horodatée contient course, chauffeur, régulateur, téléphone comme mode, rémunération et prime éventuelle | `flow.test.ts` |
| 5 | Notification chauffeur après l’attribution, sans action requise | `flow.test.ts` |
| 6 | Deux demandes concurrentes donnent un seul gagnant et une seule déclaration | `flow.test.ts` |
| 7 | Chevauchement et fatigue refusés. Catégorie et besoins du véhicule contrôlés | `flow.test.ts`, `planning-flow.test.ts`, `needs.test.ts`, `rescue.test.ts` |
| 8 | Régulateur autorisé. Chauffeur, requête anonyme et jeton de service refusés pour la déclaration | `flow.test.ts` |
| 9 | Acceptation libre, exclusive et au prix calculé dans la bourse | `flow.test.ts` |
| 10 | Connexion, révocation, OTP et contrôles de rôle | `flow.test.ts`, `driver-auth-flow.test.ts`, `security.test.ts` |

## Exécution et suite

- Local et CI. Utiliser une base PostgreSQL dédiée et appliquer les migrations. Générer le client Prisma et compiler les paquets partagés avant `pnpm test`. Exécuter `pnpm -r build` et `pnpm typecheck`.
- Le test Chromium utilise le vrai front Next.js local et intercepte les requêtes vers l’API fictive. Les tests d’intégration utilisent la vraie API NestJS locale et PostgreSQL. Les sorties e-mail/SMS de la recette automatisée reposent sur des doubles de test ou des fournisseurs inactifs.
- À valider avant une mise en service. Rejouer le scénario avec le back-office et l’API de TEST, deux comptes fictifs nominatifs, plusieurs chauffeurs fictifs et aucun fournisseur de notification réel. Vérifier l’Agenda et le journal horodaté.
