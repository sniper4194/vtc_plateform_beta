# Conditions générales partenaires : plan et décisions ouvertes

> Document de travail, **pas un texte juridique**. Il liste ce qu'un contrat partenaire (Booking, agence, hôtel) doit couvrir et ce que le produit sait déjà faire, après lecture des conditions générales « client » d'Allocab (version Particulier et Entreprise). Je n'ai pas vérifié la validité juridique de leurs clauses ; rien n'est repris tel quel. Les montants sont des propositions.

## 1. Ce que leurs conditions couvrent (et ce que nous devons trancher)

| Sujet | Chez Allocab (d'après le texte collé) | Chez nous aujourd'hui | Décision à prendre |
|---|---|---|---|
| **Qui est le vendeur ?** | Allocab vend le transport (« service de réservation et de transport ») et est inscrite au registre des exploitants VTC | Nous avons dit « simple intermédiaire technique » | **À trancher avec un juriste** : un intermédiaire n'a pas les mêmes obligations qu'un exploitant. Tout le contrat en dépend. |
| **Prix** | « Prix indicatif » à la réservation, « prix définitif » fixé après la course (itinéraire réel, attente, pénalités) | **Prix fixe** garanti au partenaire (forfaits, grilles) | Garder le prix fixe : c'est un avantage pour un partenaire. Écrire les seuls cas de supplément (attente, détour demandé, changement d'itinéraire). |
| **Annulation par le client** | Entreprise : gratuite > 2 h, 60 % entre 1 h et 2 h, 80 % < 1 h, 100 % si client absent. Particulier : gratuite jusqu'à 30 min (gammes à tarif fixe) | Provisoire : gratuite > 24 h, 50 % de 2 h à 24 h, 100 % < 2 h | À valider **partenaire par partenaire** : un grand compte négocie. Prévoir un barème par défaut et des barèmes sur mesure. |
| **Attente / client absent** | Minutes gratuites selon la gamme, puis tarif à la minute | 15 min après l'heure réelle d'atterrissage, puis client absent déclarable | Fixer l'attente gratuite par catégorie et le tarif d'attente au-delà. |
| **Retard du chauffeur** | « Garantie ponctualité » : ristourne progressive | Rien de contractuel | Décision commerciale : offrir une garantie (c'est un argument) ou non. Elle se financerait avec la pénalité du chauffeur. |
| **Introuvable de chauffeur** | « Obligation de moyens » seulement ; pas de responsabilité si aucun chauffeur n'est disponible | Alerte interne, pas de règle partenaire | Un grand compte refusera « obligation de moyens » seule. Définir : délai de confirmation, remboursement intégral, geste commercial. |
| **Responsabilité** | Dommages directs seulement ; plafond = montant de la commande concernée | Rien | Prévoir un plafond et l'exclusion des dommages indirects ; Booking négociera. |
| **Force majeure** | Liste détaillée | Rien | Reprendre le principe, adapter à l'aéroport/gare (grève, fermeture, trafic aérien). |
| **Paiement** | Carte, compte ou facturation fin de mois ; pénalités de retard et indemnité forfaitaire de recouvrement (40 €) | Pas de paiement branché | Fixer délai de paiement, facturation mensuelle, pénalités légales (l'article du Code de commerce cité chez eux a été renuméroté : à faire vérifier). |
| **Engagements RSE / éthique** | Clauses pour les transporteurs : écoconduite, véhicules propres, non-discrimination, sécurité des femmes, anticorruption, alerte | Rien | **Booking et les grands comptes les exigent dans leurs codes fournisseurs.** À prévoir côté chauffeurs et sociétés. |
| **Modification des conditions** | « S'applique automatiquement » aux commandes suivantes, sans préavis | Rien | Pour des professionnels, un préavis (par ex. 30 jours) est plus acceptable ; pour des consommateurs, une modification unilatérale peut être jugée abusive. |
| **Résiliation / inactivité** | Fermeture après 15 mois d'inactivité ; aucune restitution des sommes | Rien | Prévoir préavis, restitution des sommes dues, sort des données. |
| **Litiges** | Droit français, médiateur de la consommation (particuliers), tribunaux de Paris (entreprises) | Rien | Choisir tribunal et éventuellement médiation. |
| **Données** | Renvoi vers une politique distincte | Brouillon de politique chauffeurs/sociétés | Rédiger la politique « partenaires et passagers » (voir `POLITIQUE_DONNEES_CHAUFFEURS.md`). |

## 2. Ce qu'ils font et que nous ne ferons pas
- **Tarif indicatif puis définitif** : le partenaire ne sait pas ce qu'il paie. Notre prix fixe est plus lisible.
- **Majorations de 3 €** (chauffeur choisi, réservation par téléphone) : non pertinent pour un partenaire API.
- **Paiement par le passager final** : notre modèle est B2B2C, le partenaire reste le client.

## 3. Ce que ce texte montre sur nos propres règles
- Leur barème d'annulation client est **beaucoup plus sévère que le nôtre** (60 à 80 % entre 2 h et 1 h, contre 50 % chez nous jusqu'à 2 h, puis 100 %). Notre barème provisoire est donc dans la fourchette basse du marché ; à négocier selon le poids du partenaire.
- **Notre barème de pénalités chauffeurs est cohérent avec le leur côté client** : le partenaire qui annule tard est lourdement facturé, le chauffeur qui annule tard aussi. C'est un argument d'équité à reprendre dans le contrat.
- L'expression « **obligation de moyens** » apparaît chez eux pour l'affectation d'un chauffeur. Avec les sauveteurs, nous pouvons proposer davantage (garantie de remplacement), à condition de savoir la tenir : sinon, ne pas la promettre.

## 4. Prochaines étapes
1. Trancher le statut (intermédiaire ou exploitant) avec un juriste **avant** d'écrire le contrat.
2. Choisir un barème d'annulation par défaut et le rendre paramétrable par partenaire (il est codé en dur dans `cancellationFeeCents`).
3. Rédiger le contrat partenaire à partir de ce plan, avec relecture juridique.
4. Rédiger les conditions chauffeurs (barème de pénalités, sauveteurs, suspensions, recours), à rendre acceptables et enregistrées dans l'application.
