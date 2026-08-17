# Prépa Veni Vici — PWA mobile

Version vérifiée du 17/08/2026.

## Fichiers à mettre à la racine du dépôt GitHub Pages

- `index.html`
- `style.css`
- `app.js`
- `supabase-client.js`
- `config.js`
- `training-plan.json`
- `manifest.json`
- `sw.js`
- `supabase.sql` (utile pour Supabase, pas exécuté par GitHub Pages)
- dossier `icons/`
  - `icon-192.png`
  - `icon-512.png`

Ne mets pas le dossier `VeniVici_App_VERIFIEE` lui-même dans un sous-dossier si GitHub Pages publie la racine du dépôt : les fichiers ci-dessus doivent être au niveau publié par Pages.

## Configuration Supabase

Dans `config.js`, remplace uniquement les deux valeurs :

```js
window.APP_CONFIG = {
  supabaseUrl: "https://TON-PROJET.supabase.co",
  supabasePublishableKey: "TA_CLE_PUBLISHABLE"
};
```

Si ces valeurs restent celles d'exemple, l'application fonctionne en **mode local** dans le navigateur, sans synchronisation Supabase.

Dans Supabase > SQL Editor, exécute `supabase.sql` une fois. Puis crée ton compte dans Authentication > Users.

## Installation mobile

L'encart « Installer l'application » apparaît sur téléphone quand l'installation PWA est disponible.

- Android/Chrome : le bouton `Installer` déclenche l'installation.
- iPhone/Safari : l'encart indique d'utiliser Partager > Sur l'écran d'accueil.
- Une fois installée en mode standalone, l'encart disparaît.

## Cache

Cette version utilise le cache `veni-vici-v5` et des URLs versionnées `?v=5` pour éviter de mélanger d'anciens fichiers avec les nouveaux.

## Contrôles réalisés avant livraison

Voir `VERIFICATION.txt`.
