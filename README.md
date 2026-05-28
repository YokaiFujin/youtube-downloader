# YouTube Downloader — Desktop

Télécharge des vidéos YouTube en **MP4** (H.264, jusqu'au 4K) ou **MP3** depuis une vraie appli de bureau. Aucune limite, 100% gratuit, tout tourne sur ta machine.

## Installation

**1. Télécharge le projet**

Clique sur **Code → Download ZIP**, extrais le dossier où tu veux.

**2. Lance `setup.bat`**

Double-clique sur `setup.bat` — il installe automatiquement :
- Node.js (si absent)
- Les dépendances (Electron + Express)
- yt-dlp
- ffmpeg
- Un raccourci **YouTube Downloader** sur ton Bureau

**3. C'est tout.**

Double-clique sur le raccourci sur ton Bureau pour lancer l'appli.

---

## Utilisation

1. Colle une URL YouTube
2. Clique **Analyser**
3. Choisis **MP4** ou **MP3** + la qualité souhaitée
4. Clique **Télécharger**
5. Clique **Enregistrer dans Téléchargements**

Le fichier apparaît directement dans ton dossier `Téléchargements` avec le nom `Titre - Chaîne.mp4`.

> Ferme la fenêtre pour arrêter l'application — aucun processus ne reste en arrière-plan.

---

## Compatibilité vidéo

Les MP4 sont encodés en **H.264 + AAC**, compatibles avec :
- Adobe Premiere Pro
- DaVinci Resolve
- VLC, MPC, Windows Media Player, QuickTime…

---

## Stack

- **Electron** — fenêtre de bureau native (pas de navigateur)
- **Node.js** + Express — serveur local intégré au processus
- **[yt-dlp](https://github.com/yt-dlp/yt-dlp)** — téléchargement YouTube
- **ffmpeg** — fusion vidéo + audio, conversion AAC
