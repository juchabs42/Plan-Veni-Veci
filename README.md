# Prépa Veni Vici — PWA mobile + partage lecture seule

Application mobile-first pour consulter, modifier et partager la préparation Veni Vici 87 km.

## Fonctionnement des rôles

### Propriétaire
Le compte qui possède les lignes de `training_sessions` :
- consulte toutes les séances ;
- modifie / déplace / valide / saute les séances ;
- modifie nutrition, consignes et notes ;
- peut réinitialiser le plan ;
- ajoute ou retire des amis en lecture seule depuis **Réglages > Partage du plan**.

### Lecteur
Un ami explicitement ajouté par le propriétaire :
- voit les séances à jour, y compris les modifications du propriétaire ;
- voit la nutrition, les consignes, les statuts et les ressources ;
- ne voit aucun bouton Modifier / Déplacer / Fait / Sauter ;
- ne peut pas écrire dans Supabase grâce aux politiques RLS.

## 1. Mise à jour Supabase

1. Ouvre ton projet Supabase existant.
2. Va dans **SQL Editor**.
3. Exécute **entièrement** le nouveau fichier `supabase.sql`.
   - Il conserve la table `training_sessions` existante.
   - Il crée `training_shares`.
   - Il remplace la politique SELECT des séances pour autoriser les lecteurs.
   - Les politiques INSERT / UPDATE / DELETE restent réservées au propriétaire.
   - Il crée la fonction `share_training_with_email` utilisée par l'application.
4. Ne mets jamais de clé `service_role` ou de Secret key dans GitHub.

## 2. Fichiers GitHub à remplacer

Remplace à la racine du dépôt :

- `index.html`
- `style.css`
- `app.js`
- `supabase-client.js`
- `manifest.json`
- `sw.js`
- `training-plan.json`
- dossier `icons/`

Garde ton `config.js` actuel s'il contient déjà les bonnes valeurs Supabase. Sinon renseigne :

```js
window.APP_CONFIG = {
  supabaseUrl: "https://TON-PROJET.supabase.co",
  supabasePublishableKey: "TA_CLE_PUBLISHABLE"
};
```

Le cache PWA passe en **`veni-vici-v6-share`** pour forcer la prise en compte de la nouvelle version.

## 3. Donner accès à un ami

Ordre recommandé :

1. Ton ami ouvre l'URL de l'application.
2. Sur l'écran de connexion, il saisit son email et un mot de passe puis clique **Créer un compte lecteur**.
3. Si ton projet Supabase demande une confirmation email, il confirme son adresse puis se connecte.
4. De ton côté, ouvre **Réglages > Partage du plan**.
5. Saisis exactement son email puis clique **Ajouter**.
6. Ton ami actualise ou se reconnecte.
7. Son bandeau affiche **Lecture seule** et il voit tes séances actuelles.

Si l'adresse n'existe pas encore dans Supabase, l'application affiche `Compte introuvable` et ne crée aucun partage.

## 4. Retirer un accès

Dans **Réglages > Partage du plan**, clique **Retirer** en face de l'email.

La ligne de `training_shares` est supprimée immédiatement. Au prochain chargement, ce compte ne peut plus lire tes séances.

## 5. Sécurité

Le mode lecture seule n'est pas seulement graphique.

Dans `supabase.sql` :
- `SELECT` sur `training_sessions` = propriétaire ou lecteur autorisé ;
- `INSERT` = propriétaire uniquement ;
- `UPDATE` = propriétaire uniquement ;
- `DELETE` = propriétaire uniquement ;
- un lecteur ne possède pas de permission d'insertion directe dans `training_shares` ;
- l'ajout par email passe par une fonction SQL limitée au compte propriétaire connecté.

Même si un lecteur ouvre les outils développeur et tente une requête REST manuelle, les RLS doivent refuser les écritures sur les séances du propriétaire.

## 6. Installation sur téléphone

L'encart **Installer l'application** est conservé. Sur Android/Chrome il déclenche l'installation PWA quand le navigateur l'autorise. Sur iPhone, l'application affiche l'instruction pour utiliser **Partager > Sur l'écran d'accueil**.
