# Règles métier CliCab

## Existant

- Une réservation confirmée déclenche la distribution. La bourse filtre les offres selon les règles d’éligibilité. Le chauffeur peut accepter, passer ou laisser expirer une offre.
- La même course ne peut être attribuée qu’une fois tant qu’elle reste ouverte. Les contrôles de planning, fatigue, véhicule, catégorie et besoins voyageur s’appliquent à la prise de course.
- Le prix client est fixé à la réservation. L’offre chauffeur peut évoluer jusqu’au plafond selon la configuration. La prime écologique est calculée séparément.

## Règles applicables à l’attribution manuelle

1. Le dispatcheur ne crée jamais de courses. Il intervient notamment quand la bourse laisse une course sans chauffeur.
2. Il appelle le chauffeur, communique les informations de la course et la rémunération proposée, prime éventuelle comprise dans l’explication, puis recueille son accord verbal.
3. Un accord verbal préalable est obligatoire. Le dispatcheur saisit la rémunération de base convenue, au plus égale au plafond, puis confirme l’accord dans le back-office. Toute modification de chauffeur ou de montant exige une nouvelle confirmation.
4. Une attribution réussie enregistre la déclaration au nom du compte nominatif qui l’a faite et déclenche la notification habituelle au chauffeur. Aucune validation supplémentaire dans l’application chauffeur n’est requise.
5. L’événement décrit la déclaration de l’opérateur. Il ne prouve pas indépendamment l’accord du chauffeur.

## Cible et points à valider

Le cycle, les contrôles et les règles d’attribution s’appliquent aux trois canaux. Les SLA d’intervention, conditions commerciales et règles spécifiques d’annulation par canal sont à valider. Voir [Décisions](DECISIONS.md).
