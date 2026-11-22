# Politique de protection des données : sociétés partenaires et chauffeurs

> **BROUILLON à faire relire par un juriste ou un DPO avant toute publication.** Il décrit ce que la plateforme fait réellement aujourd'hui (d'après le schéma de données et le code), rédigé dans nos propres termes. Il a été préparé après lecture de la politique équivalente de Sixt ride, pour savoir quels sujets un chauffeur ou un partenaire s'attend à y trouver. Les passages entre crochets `[…]` sont des décisions ou des faits à fournir. Les durées de conservation sont des **propositions**, pas des obligations vérifiées.
> Version : brouillon du 21/11/2026.

## 1. Qui est responsable ?

`[Raison sociale, forme, SIREN, adresse]` (« nous ») est responsable du traitement des données décrites ici.
Contact protection des données : `[adresse e-mail dédiée]` · Délégué à la protection des données : `[nom ou « non désigné »]`.

## 2. Qui est concerné ?

- **Les sociétés partenaires** (flottes de VTC) et leurs gestionnaires qui utilisent l'espace société.
- **Les chauffeurs**, indépendants ou rattachés à une société, qui utilisent l'application chauffeur.
- (Les passagers et les partenaires de réservation font l'objet d'une politique distincte : `[à rédiger]`.)

## 3. Quelles données, pourquoi, sur quelle base

| Données | Finalité | Base juridique (à confirmer) |
|---|---|---|
| Identité du chauffeur : prénom, nom, téléphone, e-mail, langue | Créer le compte, connecter par code SMS, vous contacter | Exécution du contrat |
| Société : raison sociale, SIRET, numéro de registre VTC, IBAN | Vérifier l'habilitation, verser les paiements, établir les relevés | Exécution du contrat ; obligation légale |
| Documents : carte VTC, permis, assurance, pièce d'identité (et leurs dates d'expiration) | Vérifier le droit d'exercer, **recontrôler à chaque expiration** | Obligation légale et intérêt légitime (sécurité des passagers) |
| Véhicule : immatriculation, marque, modèle, couleur, catégorie, sièges | Affecter les missions de la bonne catégorie ; informer le passager | Exécution du contrat |
| **Position géographique** (dernière position, heure) | Proposer les missions proches, guider vers la prise en charge, informer le passager de l'arrivée | Exécution du contrat |
| Missions : horaires, trajets, statuts, événements, prix, rémunération | Exécuter et facturer le service, relevés de paiement | Exécution du contrat ; obligation légale (comptable) |
| **Note moyenne et fiabilité** (calculées) ; notes et commentaires des passagers | Qualité de service, attribution des missions, statut « sauveteur » | Intérêt légitime ; exécution du contrat |
| **Pénalités, sanctions, appels à l'aide** (qui a demandé, motif, issue) | Appliquer les règles du contrat ; tracer les décisions | Exécution du contrat |
| Messages envoyés (application, e-mail, SMS) | Confirmations, annulations, alertes | Exécution du contrat |
| Journaux techniques (connexions, adresse IP, journal d'audit) | Sécurité, prévention de la fraude, preuve | Intérêt légitime ; obligation légale |
| **Selfie de vérification d'identité** : photo de référence (conservée tant que le compte existe) selfies de prise de service et vérifications aléatoires en cours de service (supprimés après 30 jours) | Empêcher le prêt de compte, sécurité des passagers, preuve en cas de litige | **Consentement** et intérêt légitime `[à faire valider]` ; **aucune reconnaissance faciale automatique** : la comparaison est faite par un humain |

Nous ne traitons **pas** les photos par reconnaissance faciale (donnée biométrique, article 9 du RGPD) : un membre de l'équipe les compare à la main. `[À confirmer avec un DPO.]` Nous ne collectons pas d'autres données sensibles au sens strict. `[Confirmer : aucune donnée de santé n'est demandée]` : le motif d'un appel à l'aide (« malaise », par exemple) pourrait en révéler une ; il doit donc rester un choix guidé et non un champ libre, ou être traité avec précaution.

## 4. Ce que voient les autres

- **Le passager** : prénom, initiale du nom, véhicule et plaque, note moyenne éventuelle, position en approche. **Jamais** votre téléphone personnel `[à vérifier : masquage de numéro]`.
- **Les autres chauffeurs** : seuls les sauveteurs voient, dans la liste d'un chauffeur en difficulté : prénom, initiale, note, nombre de missions, distance. Pas de téléphone ni de nom complet.
- **Votre société** voit vos missions, votre performance et vos paiements ; **nous** voyons l'ensemble.
- **Les partenaires de réservation** reçoivent le nom du chauffeur et le véhicule quand ils ont réservé la mission, pas le reste.

## 5. Décisions et profilage : ce qui est automatique

Nous utilisons des calculs automatiques pour : **la note et la fiabilité, l'éligibilité au statut sauveteur, le classement des chauffeurs proposés pour une mission (proximité, disponibilité), le prix proposé qui monte avec le temps, les pénalités selon le délai, et la suspension du compte en cas de récidive**.

- Les suspensions de 48 h et de 7 jours sont décidées **automatiquement**. `[À valider avec un juriste : l'article 22 du RGPD encadre les décisions fondées uniquement sur un traitement automatisé et produisant des effets significatifs. Prévoir au minimum : information claire, possibilité de contester, intervention humaine sur demande.]`
- Une **fermeture définitive** n'est jamais automatique : elle est décidée par un humain après examen.
- Vous pouvez **contester** toute pénalité ou sanction en écrivant à `[contact]` avec un justificatif ; l'équipe peut l'annuler (accident, urgence médicale…). `[Délai de réponse à fixer]`.

## 6. Destinataires et transferts

Nous faisons appel à des sous-traitants, dont `[liste à confirmer et à contractualiser]` : hébergement `[fournisseur, pays]`, envoi de SMS `[ex. fournisseur]`, envoi d'e-mails `[ex. fournisseur]`, paiement et reversements `[ex. fournisseur]`, cartographie et calcul d'itinéraire `[ex. fournisseurs]`, données de vol `[fournisseur]`.
`[Pour chaque sous-traitant hors Union européenne : mécanisme de transfert (décision d'adéquation ou clauses types) à renseigner.]`
Nous ne vendons pas vos données.

## 7. Combien de temps nous les gardons (propositions)

| Donnée | Durée proposée |
|---|---|
| Candidature non aboutie ou incomplète | 3 mois après le dernier échange |
| Compte inactif | 3 ans après la dernière activité, puis suppression ou anonymisation |
| Documents d'identité et d'habilitation | Durée de la relation, puis `[à fixer]` |
| Position géographique | `[proposition : détaillée quelques semaines, puis agrégée ou supprimée]` |
| Missions, relevés, pièces comptables | Durées légales comptables et fiscales `[à confirmer]` |
| Pénalités et sanctions | Fenêtre de récidive (90 jours), puis conservation limitée à la preuve `[à fixer]` |
| Selfies de prise de service | 30 jours |
| Photo de référence | Durée du compte, puis suppression |
| Journaux techniques | `[proposition : 12 mois]` |

## 8. Vos droits

Accès, rectification, effacement, limitation, portabilité, opposition (notamment aux traitements fondés sur l'intérêt légitime), retrait du consentement, **et le droit de ne pas faire l'objet d'une décision purement automatisée**. Écrivez à `[contact]` ; réponse sous un mois. Vous pouvez saisir la CNIL (www.cnil.fr).
Nous ne pouvons pas effacer ce que la loi nous oblige à conserver (comptabilité, par exemple).

## 9. Sécurité

Connexion par code SMS à usage unique, mots de passe hachés, clés d'accès jamais stockées en clair, limitation des tentatives, journal d'audit. `[Chiffrement des documents, sauvegardes, gestion des accès : à décrire quand le stockage sécurisé sera en place.]`

---

# Notes de travail (hors document public)

## Ce que la lecture de la politique de Sixt ride m'apprend
- **Elle ne comporte aucune décision automatique selon l'article 22**, et le dit expressément. Nous, **si** : nos suspensions de récidive sont automatiques. C'est l'écart le plus important : soit on ajoute une revue humaine et un recours, soit on supprime l'automatisme.
- Elle **sépare la société, la personne qui distribue les courses et le chauffeur**, avec des rôles et des langues. Notre espace société existe, mais nous n'avons pas de « gestionnaire » distinct du chauffeur ni de rôles.
- Elle **justifie chaque donnée par une finalité et une base juridique**, et dit explicitement ce qu'elle partage avec le passager. Nous avons repris la méthode.
- Elle prévoit des **durées de conservation chiffrées** (3 mois, 3 ans). Nous n'avons encore aucune purge dans le code.
- Elle annonce que la position GPS est utilisée aussi **pour calculer le prix réel, détecter les trajets rallongés et traiter les réclamations**. Nous ne le faisons pas : à ne pas copier sans en avoir besoin (minimisation).
- Elle dit que **la note et les performances servent à « pénaliser ou désactiver »** les prestataires. C'est la formulation qu'un chauffeur lira : à prévoir aussi chez nous, avec le barème visible.
- Elle est **centrée sur le droit allemand** (autorité de Bavière, délais du Code de commerce allemand). Ne rien en reprendre tel quel : la nôtre dépend du droit français et de la CNIL.

## Écarts entre ce brouillon et le produit (à corriger avant le pilote)
1. **Aucune purge automatique** des données : à construire (comptes inactifs, candidatures abandonnées, positions).
2. **Aucun consentement ni acceptation enregistrés** (CGU, politique de données, clause de pénalité) : `contractSignedAt` existe mais n'est pas alimenté par un parcours d'acceptation.
3. **Position GPS** : on garde seulement la dernière, c'est bien, mais il faut vérifier qu'elle n'est pas journalisée ailleurs.
4. **Documents d'identité et selfies** : le stockage sécurisé et chiffré n'existe pas encore (les documents sont des références ; les selfies sont dans la base de données, en prototype).
5. **Suspensions automatiques** : voir section 5 (article 22).
6. **Export et suppression à la demande** (accès, portabilité, effacement) : aucun outil ; aujourd'hui ce serait manuel dans la base.
7. **Masquage du numéro du chauffeur** auprès du passager : à vérifier.
8. **Registre des traitements** et analyse d'impact (le suivi de position et la notation à grande échelle peuvent la rendre nécessaire) : à faire.
