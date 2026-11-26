# Registre des anomalies CliCab

| Référence | État | Priorité | Constat | Action et vérification |
|---|---|---|---|---|
| A01 | Corrigée dans CLI-P2-001 | P0 | Au SHA de référence, l’API permettait une attribution avec identifiant chauffeur seul, sans déclaration d’accord dans le formulaire, la requête ou le journal. | Confirmation explicite, montant convenu, trace transactionnelle et tests de refus, succès et concurrence. |
| A02 | Corrigée dans CLI-P2-001 | P0 | Le cahier des charges autorisait une attribution forcée et le README décrivait un prix imposé par le dispatch. | Règles d’accord téléphonique harmonisées. |
| A03 | À vérifier en revue | P1 | Recette de bout en bout et inventaire des éventuels clients de l’ancien contrat d’attribution sur TEST. | Vérifier l’usage des seuls comptes nominatifs et du nouveau corps de requête. Le script de courses fictives publie ses offres sur la bourse. |
| A04 | Ouverte | P1 | La documentation historique liste plusieurs paramètres métier provisoires et intégrations jamais essayées avec des comptes réels. | Valider les décisions correspondantes avant les pilotes concernés. |
| A05 | Ouverte | P2 | Les listes d’administration ont des limites fixes et la position chauffeur en direct manque au suivi voyageur. | Prioriser pagination et suivi en direct dans les chantiers dédiés. |
| A06 | À arbitrer | P1 | La suspension sur récidive est automatique dans `penalties.service.ts`, alors que les consignes générales prévoient une décision humaine. | Clarifier la règle, la revue et le recours. |

La [matrice d’audit](AUDIT_FONCTIONNEL.md) recense les écarts produits et les dépendances. Le [registre des décisions](DECISIONS.md) porte les arbitrages restant à prendre.
