# Assets

| Fichier | Usage |
|---|---|
| `logo-white.svg` | Logo du header (copie de BRANDING › Logotype › White) |
| `logo-media-white.svg` | Logo du footer « Executive Media » (Full Lock-up › White) |
| `symbol-white.svg` | Symbole en filigrane dans le CTA final |
| `favicon.svg` | Icône d'onglet : symbole Orange Soda sur Charleston Green |
| `img/*.webp` | Photos générées avec Higgsfield, en 2 ou 3 tailles (chargement responsive) |
| `img/og-image.jpg` | Aperçu 1200×630 quand le lien est partagé (LinkedIn, X…) |

## Remplacer une photo
Garde le même nom de fichier (ex. `img/hero-1600.webp`) et les mêmes proportions
(hero 16:9, cartes 4:3). Conversion : `cwebp -q 80 -resize 1600 0 photo.png -o hero-1600.webp`

## ⚠️ Avant de mettre en ligne
Le dossier `BRANDING/` (charte PDF, fichiers sources) **ne doit pas être publié** :
déplace-le hors du site ou exclus-le du déploiement.
