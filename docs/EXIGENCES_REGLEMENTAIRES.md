# Exigences réglementaires VTC : ce que dit la source et ce que fait le produit

> **Source** : fiche Service-Public « Devenir chauffeur de VTC » (Direction de l'information légale et administrative), **vérifiée le 12 août 2026**, fournie par le fondateur du projet. C'est une fiche d'information officielle, pas le texte des lois : les articles et arrêtés qu'elle cite n'ont **pas** été lus directement (le site Légifrance n'est pas accessible depuis l'environnement de développement). **Je ne suis pas juriste : tout est à faire confirmer avant le pilote.**
> Références citées par la fiche : Code des transports L3120-1 à L3120-5 (dont L3120-2 : réservation préalable), L3122-1 à L3122-9, R3120-2 à R3120-9, R3122-1 à R3122-5-1, L3124-7, L3124-8, L3124-11 et L3124-12, R1326-1 à R1326-10 (revenu des chauffeurs reliés à une plateforme) ; Code de la route R323-24 (contrôle technique) ; arrêté du 26 mars 2015 (ancienneté, dimensions, puissance), arrêté du 6 août 2025 (justificatif de réservation préalable), arrêté du 6 avril 2017 (signalétique) ; accords du 18 janvier 2023, 19 septembre 2023 et 19 décembre 2023 (revenus et transparence des plateformes).

## 1. Ce qui est CONFIRMÉ et déjà appliqué par le produit
| Exigence (fiche) | Produit |
|---|---|
| Véhicule : 4 à 9 places chauffeur compris, ≤ 7 ans, ≥ 4 portes, ≥ 4,50 m × 1,70 m, ≥ 84 kW ; hybrides et électriques exemptés des limitations ; collection exemptée d'âge | `vehicle-rules.ts` : contrôle à la validation, au dispatch, à l'attribution manuelle et à la reprise d'un sauveteur |
| Contrôle technique 1 fois par an | Document obligatoire, avec date d'échéance |
| Carte grise | Document obligatoire (date de première mise en circulation) |
| Réservation préalable obligatoire, **à prouver en cas de contrôle** (papier ou électronique) avec : exploitant, client (nom et téléphone), date/heure de réservation, date/heure et lieu de prise en charge, n° REVTC, n° Siren | **Justificatif de réservation** dans l'application, écran de mission (`GET /driver/rides/:id/justificatif`) ; signale ce qui manque |
| Numéro de carte professionnelle ; inscription de l'exploitant au registre (REVTC) | Obligatoires à la validation (chauffeur indépendant ou société de rattachement) |
| Revenu minimal **9 € par course**, net de commission | Plancher appliqué au devis et au prix proposé (`MIN_DRIVER_PAY_CENTS`) |
| Aucun dispositif lumineux extérieur ; vignette VTC | Non vérifiables à distance : à inscrire dans la charte chauffeur |
| Carte professionnelle renouvelée tous les 5 ans | Date d'échéance du document `VTC_CARD` contrôlée |

## 2. Points que la fiche révèle et que le produit NE traite PAS encore
1. **Garanties de revenu horaire (30 € par heure travaillée) et kilométrique (1 € par km)** : la fiche les cite sans détailler le calcul (heure travaillée = ? approche comprise ?). Notre échelle de prix peut les enfreindre sur une course longue ou lente. **À faire** : lire l'accord du 19 décembre 2023 et calculer sur le bon périmètre. L'application affiche déjà le net par heure.
2. **Modèle « sociétés et chauffeurs » : risque de requalification.** La fiche indique que **la mise à disposition de son inscription au registre à un tiers est interdite**, gratuite ou payante : un exploitant qui prête son inscription est **considéré comme l'employeur** (contrat de travail), avec radiation du registre et interdiction de se réinscrire jusqu'à 3 ans. Et **depuis le 27 juin 2026 les exploitants doivent déclarer au registre les conducteurs qu'ils emploient, leur carte professionnelle et leurs plaques**. Or notre espace société permet à une société d'ajouter des chauffeurs. **Les chauffeurs d'une société doivent être ses employés déclarés, ou avoir leur propre inscription.** Ce point conditionne le modèle économique : **juriste obligatoire**.
3. **Sanctions pénales renforcées depuis le 27 juin 2026** : exercer sans inscription au registre, ou prendre un client sans réservation préalable → 3 ans de prison et 45 000 € d'amende (225 000 € pour une société), avec confiscation du véhicule possible. La plateforme doit s'assurer que **chaque chauffeur est inscrit** : la fiche signale un portail de contrôle des cartes (« Cerbère ») ouvert aux plateformes. **À faire** : intégration ou contrôle manuel documenté de la validité des cartes.
4. **Transparence et désactivation (accord du 19 septembre 2023)** : les plateformes doivent mieux informer le chauffeur **en amont** sur la rupture de la relation commerciale. Nos suspensions automatiques (48 h, 7 jours) et notre barème de pénalités doivent être **écrits, accessibles avant l'inscription, et assortis d'un recours** (voir aussi `POLITIQUE_DONNEES_CHAUFFEURS.md`, article 22 du RGPD).
5. **Maraude interdite, y compris électronique** : un chauffeur sans réservation doit retourner se garer ; près d'une gare ou d'un aéroport il peut attendre un client qui a réservé **1 heure maximum**. Notre « radar » de missions est une bourse de **réservations déjà faites**, donc conforme en principe, mais **ne jamais proposer de course sans réservation**. Une règle d'attente de 1 h maximum est à ajouter à la charte.
6. **Casier judiciaire, permis de 3 ans, contrôle médical, examen** : condition d'accès à la carte professionnelle, vérifiée par l'administration. Nous contrôlons la carte, pas ces conditions.
7. **Informations CO₂ du voyageur** : citée par la charte Allocab de 2012, **absente de la fiche**. À vérifier avant de la mettre en œuvre.
8. **Prix libres, paiement à la course** : le chauffeur doit être payé à la course ; nos paiements ne sont pas encore branchés.
9. **Véhicules à deux ou trois roues (VMDTR)** : autres critères (≥ 40 kW, ≤ 5 ans). Non pris en charge.

## 3. Points d'interprétation à faire confirmer
- Que couvre « ces limitations ne s'appliquent pas aux hybrides et électriques » : d'après une source d'assureur, seulement l'âge, la puissance et les dimensions (places et portes restent exigées). Nous suivons cette lecture, plus prudente.
- Définition légale d'« hybride » (hybrides simples ? rechargeables ? seuils d'émissions ?).
- « Moins de 7 ans » : nous comptons à la date près à partir de la première mise en circulation ; confirmer la méthode.
- Le chiffre de 9 € « net de commission » est révisé chaque année ; il est réglable.
