# Prépa Veni Vici — PWA mobile

Application mobile-first pour consulter et réorganiser la préparation Veni Vici 87 km depuis un téléphone.

## Ce que fait la V1

- écran **Aujourd'hui** : séances AM/PM, durée, RPE, D+, nutrition, consignes et détail de séance ;
- routine du soir automatiquement affichée selon le jour ;
- écran **Semaine** : toutes les séances prévues, y compris celles déplacées ;
- modification d'une séance : date, créneau, horaire, contenu, durée, RPE, D+, nutrition, consignes, notes ;
- statuts **Prévue / Faite / Sautée** ;
- badge **Modifiée** / **Déplacée** quand le plan n'est plus identique à l'Excel ;
- bouton **Revenir au plan initial** pour une séance ;
- ressources : bibliothèque de séances, musculation, chaleur, nutrition, affûtage et routine du soir ;
- PWA installable sur téléphone ;
- lecture hors ligne du dernier planning chargé ;
- mode local automatique tant que Supabase n'est pas configuré.

## 1. Supabase

1. Crée un projet Supabase.
2. Ouvre **SQL Editor** et exécute entièrement `supabase.sql`.
3. Dans **Authentication > Users**, crée ton compte avec email + mot de passe. L'application ne propose volontairement pas d'auto-inscription.
4. Dans le menu **Connect** du projet, récupère :
   - le **Project URL** ;
   - la **Publishable key** (`sb_publishable_...`).
5. Ouvre `config.js` et remplace les deux valeurs d'exemple.

La publishable key est destinée au code frontend. La sécurité des données repose sur les politiques RLS de `supabase.sql`. **Ne mets jamais une Secret key / service_role key dans GitHub ou dans `config.js`.**

Au premier login, si ton compte n'a encore aucune séance, l'application importe automatiquement le plan contenu dans `training-plan.json`.

## 2. GitHub Pages

Dépose à la racine du dépôt :

- `index.html`
- `style.css`
- `app.js`
- `config.js`
- `manifest.json`
- `sw.js`
- `training-plan.json`
- le dossier `icons/`

Puis : **Settings > Pages > Deploy from a branch > main / root**.

`supabase.sql` et ce README peuvent rester dans le dépôt ; ils ne sont pas utilisés par le navigateur.

## 3. Installation sur téléphone

Ouvre l'URL GitHub Pages. Sur un navigateur compatible, le bouton `+` du bandeau permet l'installation. Il disparaît quand l'application est déjà lancée en mode installé.

## 4. Modifier la préparation

Dans **Aujourd'hui** ou **Semaine**, touche une séance :

- **Modifier** pour changer son contenu ;
- **Déplacer** pour changer sa date/créneau ;
- **Fait** pour la valider ;
- **Sauter** si elle n'est pas réalisée.

L'Excel n'est jamais écrasé : `training-plan.json` reste la référence. Chaque ligne Supabase conserve les valeurs d'origine dans `original_data`.

Dans **Réglages**, le bouton **Réinitialiser depuis l'Excel** supprime tes séances Supabase et réimporte le plan de référence. Cette action demande une confirmation.

## Important pour les mises à jour GitHub

Les noms `app.js` et `style.css` sont volontairement stables. Lors d'une mise à jour, remplace simplement les fichiers existants.
