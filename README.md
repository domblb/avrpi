# Pioneer Remote

Télécommande web complète pour récepteurs Pioneer VSX (testée sur VSX-1021), en remplacement d'iControlAV2.
Aucune dépendance : Node.js ≥ 18 suffit.

> Application **non officielle**, non affiliée à Pioneer ni à Onkyo.

## Installer sur Android

1. Sur le téléphone, ouvre **[la dernière version](https://github.com/domblb/pioneer-remote/releases/latest)** et télécharge `Pioneer-Remote-X.Y.Z.apk`.
2. Touche le fichier téléchargé. Si Android bloque : **Paramètres** → autoriser cette source → retour.
3. **Installer** (si Play Protect avertit : « Installer quand même »).

Les mises à jour s'installent par-dessus, réglages conservés. **Réglages → À propos → Rechercher une mise à jour** indique quand une nouvelle version est sortie.

## Ton ampli ne réagit pas comme prévu ?

L'appli détecte ce que sait faire chaque modèle, mais beaucoup n'ont jamais été testés sur du vrai matériel.
Touche l'icône **⚠** en haut (ou **Réglages → À propos → Envoyer un rapport**), coche **Diagnostic complet** et envoie le rapport par mail :
il contient le modèle, le firmware et les réponses de l'ampli (IP et MAC masquées), de quoi corriger l'appli pour ton modèle.

## Soutenir le projet

L'appli est gratuite et open source. Si elle te rend service, tu peux soutenir son développement sur Patreon (lien dans **Réglages → À propos**).

## Lancer

```
cd app
npm start            # http://localhost:3000
```

Au premier lancement : **Rechercher le récepteur** (SSDP, puis balayage du réseau avec vérification `?P` → `PWR`),
ou saisis l'IP. L'adresse est mémorisée dans `config.json` et reconnectée au démarrage.

## Compatibilité avec d'autres amplis

L'appli ne suppose pas un VSX-1021 : elle **détecte ce que l'ampli sait faire** pendant la lecture initiale et n'affiche que ça.

- **Écrans adaptatifs** : Zones (zone 2 et/ou zone 3), Radio, Vidéo, Enceintes n'apparaissent que si l'ampli répond.
- **Formats tolérants** : nombre de canaux de niveau, de bandes d'égaliseur et d'entrées variables ; réponse `?AST` courte ou longue.
- **Deux familles de niveaux par canal** : `ILV` (VSX anciens, un bloc) et `CLV` (modèles récents, canal par canal). Le reste de l'appli ne voit pas la différence.
- **Identification** : modèle (`RGD`), version (`SSI`), nom réseau (`SSO`), adresse MAC (`SVB`) lus et affichés.
- **Réglages de compatibilité** (Réglages → Compatibilité) : délai entre commandes (certains modèles exigent plus de 100 ms) et échelle de volume (max, valeur de 0 dB, dB par pas).
- **Prudence** : les réglages d'installation (coupure, position des surround, courbe X, configuration des enceintes, verrous) demandent une confirmation, et le serveur la refuse sans `confirm`.

Les codes des modèles autres que le VSX-1021 viennent de la bibliothèque `aiopioneer` et n'ont pas été testés sur du matériel : si un réglage
n'a pas d'effet sur ton ampli, il ne s'affichera simplement pas (ou l'ampli répondra « NOT AVAILABLE »). Le **mode démo** propose deux profils
(*ancien VSX* et *modèle récent*) pour voir ces différences sans matériel.

## Mode démo

Pas de récepteur sous la main ? Sur l'écran de connexion (ou dans **Réglages**), **Essayer le mode démo** lance un récepteur
simulé *dans le serveur* : vraies entrées (CD, TUNER, BD…), stations radio, afficheur, et un plan d'enceintes qui suit le mode
d'écoute (STEREO direct = avant seulement, STANDARD = 5.1…). Une bannière rappelle qu'aucun appareil réel n'est piloté ;
rien n'est enregistré dans `config.json`. La démo se coupe avec **Quitter la démo**.

## Confort d'utilisation

- Barre de progression pendant la lecture initiale de l'état, bannière **Récepteur en veille** avec bouton *Allumer*.
- Volume : appui maintenu sur − / + pour répéter ; raccourcis clavier (`↑` `↓` volume, `M` mute, `P` alimentation, `1`–`9` écrans, `?` aide).
- Thème clair/sombre en un clic, icônes d'entrées, titre et description sur chaque écran.
- Mobile : barre du bas (Accueil, Enceintes, Son, Presets) + menu **Plus** ; aucun défilement horizontal.

## Écrans

| Écran | Contenu |
|---|---|
| Accueil | Afficheur du récepteur, cadran de volume, mute, entrées, mode d'écoute, presets, **carte Emphase** |
| Enceintes | Plan de salle : état de chaque canal, niveaux (±12 dB), **balance dirigée** par glisser du point d'écoute, isolement d'un canal (maintenir), déplacement des enceintes, système d'enceintes, réglages système `SSC` |
| Son | **Emphase**, modes d'écoute (117 codes, détection des modes disponibles), réglages audio avancés (≈25 paramètres), tonalité, égaliseur graphique ±6 dB |
| Vidéo | Convertisseur, résolution, Pure Cinema, réglages avancés (`VT*`) |
| Zone 2 / Radio | Zone 2 ; fréquence et mémoires A–G |
| Presets | Ambiances en un clic capturées depuis l'état actuel |
| Terminal / Réglages | Codes bruts ; limite de volume, thème |

### Emphase du dialogue et des graves

Carte « Emphase » (Accueil et Son) :
- **Dialogue** : *Dialog Enhancement* (`ATH` : Off, Flat, +1…+4) et niveau du canal centre (`ILV`).
- **Graves** : niveau du caisson (`ILV`), graves de la tonalité (`BA`, ±6 dB, tonalité activée) et atténuateur LFE (`ATM` : 0, −5, −10, −15, −20 dB, coupé).
- Scènes rapides : *Neutre*, *Dialogue* (ATH +2, centre +3 dB), *Graves* (caisson +3 dB, tonalité +3 dB), *Dialogue + graves*.

Certains réglages (`ATP`, `ATS`, `ATR`, `ATU`, `ATE`…) ne sont valides que dans certains modes d'écoute : le récepteur affiche
« NOT AVAILABLE » et l'appli le signale.

## Sécurité

- **Limite de volume** : le serveur refuse tout volume au-dessus du plafond (cadran, presets, terminal). Réglable dans Réglages, 0 dB par défaut.
- Le cadran ne démarre que si on saisit le bouton (pas de saut sur un clic).
- Le serveur écoute en local uniquement ; pour un téléphone : `HOST=0.0.0.0 npm start` (aucune authentification, réseau de confiance seulement).

## Protocole (confirmé sur un VSX-1021)

TCP port **23** (telnet) ou **8102** ; commandes ASCII terminées par `\r`. Lecture : `?V` → `VOL130`. Écriture : **valeur avant le code**
(`050VL`, `04FN`, `1IS`, `3ATH`, `<17×2 chiffres>ILV`, `<11×2 chiffres>ATB`). `50` = neutre pour `ILV`/`ATB`/`VT*`, 1 unité = 0,5 dB.
Tables dans `lib/protocol.js` ; sources : réponses du VSX-1021, APK iControlAV2 et
[aiopioneer](https://github.com/crowbarz/aiopioneer) (modes d'écoute, paramètres DSP, disposition de `?AST`).

À savoir :
- Le port 8102 n'accepte qu'une connexion à la fois ; le port 23 reste utilisable en parallèle.
- Zone 3 et plusieurs paramètres récents (`ATI`, `ATV`, `ATW`, `ATY`, `ATZ`, `VSP`, `VWD`) ne sont pas gérés par ce modèle : ils n'apparaissent pas.
- `ATF` (délai) s'exprime en images (0,1 par pas) sur ce modèle ; `ATM` s'écrit sur 1 chiffre.
- Les libellés des réglages vidéo `VTE…VTQ` viennent de la documentation communautaire, non vérifiés sur l'ampli.

## Tests

```
npm run fake         # faux récepteur (TCP 8102 + SSDP) pour essayer sans matériel
npm test             # 29 tests : protocole, paramètres, découverte, API, presets, plafond de volume
```

Variables : `PORT`, `HOST`, `PIONEER_CONFIG`, `PIONEER_PRESETS` (chemins des fichiers de config/presets).
