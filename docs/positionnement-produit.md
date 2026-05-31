# vautcher — Positionnement produit

> **Un OS de fidélisation pour restaurants, pas une marketplace.**
> Document d'une page pour cadrer les décisions de build. En cas de doute sur une feature : « est-ce que ça nous rapproche de TheFork ? Si oui, on ne le construit pas. »

---

## Le constat

TheFork (et les annuaires de réservation en général) est un acteur **côté demande** :

- Le client va **chez eux** pour trouver _n'importe quel_ restaurant.
- La **plateforme possède la relation client** et la donnée.
- Le restaurant paie **une commission par couvert** et se retrouve **noyé dans une liste uniforme**, en concurrence sur le classement.

C'est un terrain où l'on perd : ils ont la demande et la machine à commissions. Reproduire leurs features (annuaire concurrentiel, réservation à la commission, avis agrégés, « trouver un resto près de moi ») revient à les affronter sur leur force.

## Notre positionnement

vautcher est l'inverse : un acteur **côté offre**.

> **L'app que le restaurant remet aux clients qu'il a déjà — pour les faire revenir.**
> Outil de **rétention**, pas d'**acquisition**.

| | TheFork | vautcher |
|---|---|---|
| Côté du marché | Demande (le client cherche) | Offre (le resto fidélise) |
| Propriétaire de la relation client | La plateforme | **Le restaurant** |
| Modèle économique | Commission par couvert | **Abonnement / forfait outil** |
| Identité de marque | Liste uniforme | **App 100 % brandée par resto** |
| Objectif | Acquérir de nouveaux clients | **Faire revenir les habitués** |
| Distribution | Marketplace | **Canaux du restaurant** (QR, lien, Wallet) |

## Ce qu'on construit — uniquement les différenciateurs

Ce que TheFork ne peut **structurellement** pas faire (leur valeur repose sur l'uniformité et la comparaison) :

- **App entièrement brandée par restaurant** — couleurs, typographies, ton. Le client entre dans _ce_ restaurant, pas dans « vautcher ».
- **Fidélité définie par le restaurant** — tampons, vautchers, récompenses conçus par le propriétaire (pas une monnaie de plateforme type « Yums »).
- **Événements + RSVP/capacité** — communauté et visites répétées, _pas_ de la réservation de table.
- **Pass Apple Wallet** — la marque du restaurant qui vit sur le téléphone du client.
- **Scaffolding instantané URL → app brandée** — onboarding en minutes, vs. la vente manuelle de TheFork.
- **Messagerie / push direct restaurant → client** — TheFork s'interpose volontairement ; nous, on rend le canal au restaurant.

## Ce qu'on ne construit pas — le terrain de TheFork

- ❌ Annuaire / écran de découverte concurrentiel où les restos se battent pour le classement.
- ❌ Inventaire de réservations + commission par couvert.
- ❌ Avis agrégés (Google et TheFork possèdent déjà ce terrain).
- ❌ « Trouver un restaurant près de moi » / agrégation de la demande.

## Le compromis assumé

Ne pas être une marketplace, c'est **renoncer à la distribution marketplace**. Le client ne découvre jamais _vautcher_ : c'est le restaurant qui amène ses propres clients —

- **QR sur la table**, **lien sur son site**, **pass Wallet** déjà installé.

Croissance **portée par les restaurants** : plus lente, mais **défendable**, à **meilleure marge**, et **jamais en concurrence frontale avec TheFork** pour le même client. Conséquence directe : l'écran « annuaire » n'est **pas** notre écran héros — **l'app brandée d'un seul restaurant l'est** (cf. `mockups/entry.html`).

## Principe directeur

> Chaque feature doit **renforcer la marque du restaurant et sa relation directe avec ses clients.**
> Si une feature transfère la relation, la donnée ou la découverte **vers la plateforme**, c'est de la marketplace — on ne la construit pas.

---

_Mockups associés : `mockups/entry.html` (parcours d'entrée) · `mockups/index.html` (10 marques sur un même squelette)._
