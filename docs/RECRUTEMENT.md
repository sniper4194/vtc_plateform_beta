# Recrutement des chauffeurs : parcours de candidature

Ce parcours met en œuvre la politique de sélection exigeante de CliCab. Il est volontairement **strict et traçable** : on peut montrer à un partenaire qui a fait entrer chaque chauffeur et quelles vérifications ont été faites.

> Les seuils ci-dessous sont des choix de l'équipe, réglables par variables d'environnement. Ce ne sont pas des normes légales. Le cadre juridique (RGPD, données sur le permis, droit de la non-discrimination, risque de requalification) est à faire valider par un juriste avant le recrutement au-delà du cercle des fondateurs.

## Étapes

1. **Code de parrainage (obligatoire).** Sans code valide, impossible de déposer une candidature.
   - *Codes fondateurs* : créés par l'équipe (back-office, Recrutement, Codes de parrainage) pour la première cohorte. Les fondateurs passent exactement les mêmes vérifications que les autres.
   - *Codes de chauffeur* : un chauffeur **actif** peut créer jusqu'à `REFERRAL_CODES_PER_DRIVER` codes (3 par défaut), chacun à usage unique (`GET/POST /driver/referral`).
   - Un refus ou un retrait libère le code. Un code révoqué ne fonctionne plus. Le message d'erreur est identique dans tous les cas (on ne révèle pas quels codes existent).
2. **Dépôt** : page publique `/candidature` (application `web-booking`) ou `POST /apply` : identité, années d'expérience, autres plateformes (déclaratif), consentement. Limité à `APPLY_IP_PER_HOUR` dépôts par heure et par IP.
3. **Vérifications** par un administrateur (onglet *Recrutement*) :
   - carte professionnelle VTC valable au moins `APPLY_CARD_MARGIN_DAYS` jours (30) ;
   - **relevé d'information intégral (RII)** consulté : l'administrateur saisit le nombre de points et l'absence de suspension ; **seul le résultat est enregistré** (seuil `APPLY_MIN_POINTS`, 8 par défaut ; ni le relevé, ni le nombre de points) ;
   - déclaration sur l'honneur d'absence de condamnation incompatible reçue. Le casier judiciaire n'est **pas** demandé : la carte professionnelle est délivrée après contrôle de la préfecture.
4. **Tests** (mises en situation notées par l'équipe) : français (`APPLY_MIN_FRENCH`, 60/100), anglais (niveau CECRL, `APPLY_MIN_ENGLISH`, B1), éthique (`APPLY_MIN_ETHICS`, 70/100). Pas de test « psychotechnique » : des mises en situation (client ivre, litige, pourboire, vol en retard…) sont plus défendables.
5. **Entretien** enregistré (compte rendu).
6. **Décision humaine** : *Accepter* est **impossible tant qu'un critère manque** (aucune dérogation, et la liste de ce qui manque s'affiche). *Refuser* exige un motif, communiqué au candidat par e-mail avec la possibilité de contester.
7. **Acceptation** : le compte chauffeur est créé (`PENDING_DOCUMENTS`), rattaché à son parrain ; il fournit ensuite ses documents et son véhicule, validés comme avant dans l'onglet *Chauffeurs*.

Années d'expérience : demandées et affichées, mais non éliminatoires par défaut (`APPLY_MIN_YEARS=0`). Notes sur d'autres plateformes : déclaratives, non vérifiables, **jamais éliminatoires seules**.

## Traçabilité

- Chaque action est inscrite dans le journal d'audit (qui, quand, quoi) et visible dans l'historique de la candidature.
- **Arbre de parrainage** (`GET /admin/applications/tree`, onglet *Arbre de parrainage*) : qui a fait entrer qui, avec les fondateurs en racine.
- Aucune dérogation automatique ; aucun refus automatique : l'outil liste, la personne décide (RGPD art. 22).

## Données personnelles

- Pièces non conservées (RII, carte professionnelle) : seul le résultat est noté.
- Une candidature refusée ou retirée est **rendue anonyme** après `APPLY_RETENTION_DAYS` jours (180). L'effacement à la demande est possible (`POST /admin/applications/:id/anonymize`), sauf si un compte chauffeur y est lié.
- Un candidat refusé peut redéposer après `APPLY_RETEST_DAYS` jours (30).
- À faire : mentionner ce traitement dans la politique de confidentialité du site (`apps/site/confidentialite.html`) : finalité, base légale, durée, droits.

## Variables d'environnement

| Variable | Défaut | Rôle |
|---|---|---|
| `APPLY_MIN_POINTS` | 8 | points de permis minimum |
| `APPLY_MIN_FRENCH` / `APPLY_MIN_ETHICS` | 60 / 70 | scores minimums (sur 100) |
| `APPLY_MIN_ENGLISH` | B1 | niveau d'anglais minimum |
| `APPLY_MIN_YEARS` | 0 | années d'expérience minimum |
| `APPLY_CARD_MARGIN_DAYS` | 30 | validité restante minimale de la carte pro |
| `REFERRAL_CODES_PER_DRIVER` | 3 | codes qu'un chauffeur peut créer |
| `APPLY_RETEST_DAYS` | 30 | délai avant de pouvoir redéposer |
| `APPLY_RETENTION_DAYS` | 180 | conservation des candidatures refusées |
| `APPLY_IP_PER_HOUR` | 5 | dépôts par heure et par adresse IP |

## Limites connues

- Les tests de français, d'anglais et d'éthique sont **saisis à la main** (scores) : l'outil ne les fait pas passer.
- Le contrôle du RII est déclaratif (l'administrateur le consulte et saisit le résultat) : l'outil ne peut pas vérifier l'authenticité du document.
- Le quota d'un code est vérifié sans verrou : deux dépôts simultanés avec un code à usage unique pourraient, dans de très rares cas, passer tous les deux.
- Pas de notification de l'équipe à l'arrivée d'une candidature (à consulter dans le back-office).
