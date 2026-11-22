# Charte chauffeur : plan et écarts avec le produit

> Document de travail, **pas un texte juridique**. Il part de la « Charte qualité et d'éthique » d'Allocab (version de **2012**, donc ancienne). Les règles de la profession ont changé depuis : **toute exigence réglementaire citée ci-dessous doit être revérifiée dans les textes en vigueur** avant d'être reprise. Rien n'est copié ; ce sont des sujets à couvrir dans notre propre charte.

## 1. Les engagements que couvre une charte de ce type

**Envers la plateforme et les autres chauffeurs**
- Tenir son agenda à jour et signaler ses indisponibilités.
- **Honorer toutes les missions acceptées**, les réaliser conformément à la commande.
- Être ponctuel ; **prévenir le client sans délai** en cas d'impondérable.
- Prestation sûre et de qualité, équipement confortable et propre.
- **Ne pas démarcher les clients de la plateforme** : pas de cartes de visite, pas d'appel commercial, pas de fichier des coordonnées.
- Informations exactes et à jour sur le véhicule et le chauffeur ; bonne foi et transparence ; assurance en cours de validité.

**Envers la réglementation** (à revérifier, texte de 2012)
- Carte professionnelle, permis valide, absence de condamnations incompatibles.
- Critères du véhicule (nombre de places, âge, dimensions, puissance, signalétique).
- Réservation préalable obligatoire ; pas de maraude ; stationnement réglementé aux gares et aéroports.
- Information du voyageur sur les émissions de CO₂ de la prestation.

## 2. Ce que notre produit fait déjà
| Engagement | Dans le produit |
|---|---|
| Ponctualité, prévenir le client | Suivi de vol, heure effective, attente de 15 min avant « client absent » |
| Honorer les missions | Pénalité progressive si on rend une mission, sanctions de récidive |
| Prévenir en cas d'impondérable | **Sauveteurs** : relais encadré, pénalité réduite |
| Agenda à jour | Disponibilité en ligne/hors ligne, détection des chevauchements de missions |
| Infos exactes, assurance | Documents obligatoires (carte VTC, permis, assurance, pièce d'identité), contrôle d'expiration, validation manuelle |
| Qualité | Notes, fiabilité, tableau de performance |

## 3. Écarts (à traiter avant d'accepter de vrais chauffeurs)
1. ~~Aucune vérification du véhicule contre des critères~~ **Traité (voir README, « Critères d'admission du véhicule »)**, valeurs à confirmer. Contexte d'origine : nous stockons marque, modèle, couleur, places, catégorie, mais ni année, ni portes, ni dimensions, ni puissance. Et nous ne demandons ni carte grise ni contrôle technique par défaut (ils existent dans la liste des types de document, pas dans les documents obligatoires). **À faire** : fixer les critères en vigueur avec un juriste, ajouter les champs, contrôler à l'inscription.
2. **Pas de démarchage interdit dans nos règles, et pas de protection technique** : le chauffeur voit le nom et le téléphone du passager dès l'acceptation. **À faire** : clause d'interdiction de démarchage, durée de conservation côté application, **numéro masqué** si possible.
3. **Information CO₂ du voyageur** : obligation citée dans la charte, absente de nos messages. À vérifier dans le droit actuel, puis à ajouter aux confirmations (il faut une source de calcul).
4. **Casier et condamnations** : aucune vérification (la carte professionnelle les couvre en principe). À confirmer avec le juriste : suffit-il de contrôler la carte et sa date d'expiration ?
5. **Aucun enregistrement de l'acceptation de la charte** : `contractSignedAt` existe mais n'est alimenté par aucun parcours.
6. **Pas de signalement d'éthique** (canal d'alerte), ni de politique de sécurité des passagers (notamment des femmes) à faire signer.

## 4. Sujets que la charte Allocab ne couvre pas et que nous devons traiter
- **Barème de pénalités et récidive** (nos règles) : à inscrire dans la charte, avec la dérogation sur justificatif et le recours.
- **Sauveteurs** : critères d'accès, prime, obligations du repreneur, responsabilité lors d'un relais.
- **Données personnelles** : voir `POLITIQUE_DONNEES_CHAUFFEURS.md`.
- **Décision automatique et recours** (article 22 du RGPD), à relier aux suspensions.

## 5. Proposition de plan de la charte (nos mots)
1. Notre engagement envers vous (prix affiché, paiement, recours).
2. Votre engagement envers nous (honorer les missions, ponctualité, prévenir tôt, informations exactes).
3. Envers le passager (sécurité, respect, non-discrimination, confidentialité, non-démarchage).
4. Envers la loi (documents, véhicule, règles de réservation) : `[liste vérifiée par un juriste]`.
5. Annulation, sauveteurs, pénalités, récidive, dérogation, recours.
6. Données et vie privée.
7. Alerte et éthique.
8. Acceptation enregistrée (date, version), à chaque changement de version.
