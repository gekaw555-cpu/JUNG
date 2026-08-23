# Prototype — Agent « Révéler l'Ombre »

Prototype web minimal pour **tester le comportement conversationnel de l'agent** avant d'investir dans une vraie app mobile. Ce n'est pas un aperçu du design final de l'app — juste un banc d'essai.

## Architecture

```
ombre-jungienne-app/
├── server.js           # serveur Express : sert le front + proxy vers l'API Anthropic
├── system_prompt.md     # copie figée du system prompt verrouillé (source : scratchpad system_prompt_agent_ombre.md)
├── Dockerfile            # build utilisé par Render (voir section Déploiement)
├── public/
│   ├── index.html        # écran de chat unique
│   ├── style.css
│   ├── app.js             # logique front : historique local, appels à /api/chat, code d'accès
│   ├── manifest.webmanifest  # PWA : nom, icônes, couleurs, mode plein écran
│   ├── sw.js               # service worker (coquille en cache, jamais les appels /api/*)
│   └── icons/               # icônes PWA (générées, voir section PWA)
├── .env.example
└── package.json
```

**Flux d'un message :**
1. Le navigateur garde tout l'historique de la conversation en mémoire JS (variable `messages`, perdue au refresh — voir « Ce qui n'est pas implémenté »).
2. Chaque envoi POSTe l'historique complet à `/api/chat`.
3. `server.js` lit `system_prompt.md` **une fois au démarrage** et l'envoie comme paramètre `system` à chaque appel de l'API Anthropic (`POST /v1/messages`), avec le tableau `messages` reçu du client.
4. Le texte de la réponse est renvoyé tel quel au front, qui l'affiche.

Le system prompt n'est donc jamais modifié par le code : le serveur le charge en lecture seule. Pour changer le comportement de l'agent, on édite `system_prompt.md` (et on répercute le changement dans le fichier de référence du projet si besoin), pas le code.

## Installation

```bash
cd ombre-jungienne-app
npm install
cp .env.example .env
```

Puis éditer `.env` et renseigner votre clé Anthropic (`ANTHROPIC_API_KEY`). **Ne jamais commiter ce fichier** (il est dans `.gitignore`).

> **Note réseau (cas rare) :** si `npm start` échoue avec une erreur `UNABLE_TO_VERIFY_LEAF_SIGNATURE` en local, c'est que votre réseau (proxy d'entreprise, environnement sandboxé) intercepte le TLS et que Node n'a pas confiance dans son certificat. Utilisez alors `npm run start:local-tls-fix` à la place (nécessite Node 22.9+ — ce flag n'existe pas sur les versions plus anciennes, et **ne doit jamais être utilisé en production/déploiement**, où ce problème réseau n'existe pas).

## Lancer

```bash
npm start
```

Ouvrir [http://localhost:3000](http://localhost:3000).

## Ce qui n'est délibérément PAS implémenté ici (et pourquoi)

- **Carnet de suivi individuel (mémoire persistante, structurée, entre sessions et appareils).** L'historique brut de la conversation est conservé via `localStorage` du navigateur (voir ci-dessous), mais ce n'est **pas** le carnet de suivi : pas de synthèse structurée (symboles de rêves récurrents, projections nommées, jalons de vie, historique du protocole de détresse), rien de partagé entre appareils, et rien côté serveur. Le concept réel de carnet de suivi a déjà été esquissé dans `carnet_suivi_individuel.md`, mais sa persistance touche à des données de santé au sens du RGPD (art. 9 — catégorie spéciale) : chiffrement, minimisation, durée de conservation, droit à l'effacement effectif. Ça mérite une conception dédiée, pas un ajout rapide à ce prototype.
- **Filet de sécurité côté serveur.** La détection de détresse et la redirection (ligne 3114, etc.) reposent entièrement sur le jugement du modèle via le system prompt verrouillé — il n'y a aucune couche de mots-clés ou de modération côté code. Pour une vraie mise en production, il faudrait probablement un filet supplémentaire (ex. journalisation des échanges signalés comme sensibles, alerte) au cas où le modèle raterait un signal — décision à prendre plus tard, volontairement absente ici.
- **Comptes utilisateurs / authentification individuelle.** Il y a un code d'accès *partagé* (voir plus bas), mais aucune notion de compte, d'utilisateur distinct, ou de session identifiée. Une session anonyme par onglet.
- **Design mobile final.** Cette interface est volontairement neutre (contenue dans une colonne façon smartphone) pour tester la conversation, pas pour préfigurer l'identité visuelle de l'app.

## Entrée/sortie vocale — 2026-08-23

Deux boutons, tous deux via les API natives du navigateur (aucun service tiers, aucun coût, aucune clé supplémentaire) :

- **🎤 Micro (dictée)** — à côté du champ de texte. Utilise `SpeechRecognition` (Web Speech API). Remplit le champ avec ce qui a été dit ; l'envoi reste manuel (bouton Envoyer ou touche Entrée), pour éviter d'envoyer une transcription mal comprise sans relecture. N'apparaît que si le navigateur le supporte — bon support sur Chrome (desktop et Android), partiel/absent sur Safari selon la version d'iOS. Aucune dégradation si absent : il suffit de taper comme avant.
  - **Durée illimitée (2026-08-23) :** le navigateur coupe l'écoute après un silence ou une limite interne (souvent ~60s), même en mode continu — c'est une contrainte du navigateur, pas quelque chose qu'on peut désactiver. Contournement : tant que l'utilisateur n'a pas appuyé sur le bouton pour arrêter, toute coupure du navigateur est automatiquement suivie d'un redémarrage silencieux de l'écoute, et le texte déjà transcrit est conservé. Dans la pratique, ça revient à une durée illimitée tant qu'on parle.
  - **Coupure automatique en fin de parole (2026-08-23) :** distinct du point ci-dessus. Un minuteur de 2,5s sans nouvelle parole détectée arrête l'écoute automatiquement (pas besoin de rappuyer sur 🎤 quand on a fini de parler) — remis à zéro à chaque nouveau mot transcrit, donc les pauses naturelles d'une phrase normale n'interrompent rien.
- **🔊/🔇 Lecture à voix haute** — bouton en haut à droite, à côté de « Nouvelle conversation ». Utilise `SpeechSynthesis`, activable/désactivable, état retenu dans `localStorage`. Quand activé, chaque nouvelle réponse de l'agent est lue automatiquement (texte nettoyé de la syntaxe markdown au préalable), et une phrase de confirmation est prononcée immédiatement à l'activation (retour instantané, pas besoin d'attendre le prochain message pour juger de la voix). Coupée automatiquement dès qu'on relance le micro (pour que l'app n'entende pas sa propre voix) ou qu'on envoie un nouveau message.
- **Sélecteur de voix (2026-08-23)** — apparaît sous l'en-tête quand la lecture vocale est activée. Liste toutes les voix françaises disponibles sur l'appareil (le nombre et la qualité varient énormément selon l'OS — Android/iOS ont souvent plusieurs voix, parfois des variantes "enhanced"/"premium" nettement plus naturelles que la voix système par défaut). Le choix est mémorisé. Gère aussi le cas où le navigateur charge la liste des voix de façon asynchrone (fréquent) — sans ce correctif, le sélecteur pouvait rester vide au premier chargement.

**Confidentialité :** la reconnaissance vocale de Chrome transite par les serveurs de Google pour être transcrite (comportement standard du navigateur, hors de notre contrôle) — à mentionner si la confidentialité de ce qui est dit à voix haute est sensible pour l'usage prévu.

## Installation sur téléphone (PWA) — 2026-08-23

L'app est maintenant une **Progressive Web App** : installable sur l'écran d'accueil d'un téléphone (Android et iOS), s'ouvre en plein écran sans barre d'adresse, comme une vraie app. Ce n'est **pas** une app native ni un fichier `.apk`/`.ipa` — pas de compte développeur, pas de Play Store/App Store, pas d'Android Studio ni de Mac nécessaires. C'est le choix par défaut le plus rapide ; si vous voulez aller plus loin (APK installable, publication sur un store), il faudra une étape supplémentaire (ex. empaqueter avec Capacitor) — pas fait ici, dites-le si vous voulez qu'on y aille.

**Pour l'installer :**
- **Android (Chrome)** : ouvrir l'URL, menu ⋮ → « Ajouter à l'écran d'accueil » (ou une bannière d'installation peut apparaître automatiquement).
- **iPhone/iPad (Safari uniquement — pas Chrome iOS)** : ouvrir l'URL, bouton Partager (carré avec flèche) → « Sur l'écran d'accueil ».

**Ce qui a été ajouté :**
- `public/manifest.webmanifest` — nom, icônes, couleurs, mode `standalone` (plein écran, sans barre de navigateur).
- `public/icons/` — icônes générées (fond brun de la charte, motif en croissant), en plusieurs tailles dont une variante « maskable » pour Android (marge de sécurité contre le rognage en cercle/carré-arrondi selon le launcher).
- `public/sw.js` — service worker minimal : met en cache la coquille de l'app (HTML/CSS/JS/icônes) pour un chargement plus rapide et un minimum de tolérance hors-ligne, mais **jamais** les appels à `/api/*` (conversation toujours en réseau direct, jamais mise en cache).
- Balises dans `index.html` pour qu'iOS (qui ignore le manifest pour l'écran d'accueil) affiche aussi la bonne icône et s'ouvre en plein écran.

**Limite connue :** comme le service gratuit Render s'endort après inactivité, la première ouverture de l'app installée après une pause peut mettre jusqu'à 50 secondes à répondre — l'app affichera l'écran de chargement en attendant, pas un bug.

## Persistance locale de la conversation

La conversation est sauvegardée dans `localStorage` (clé `ombre-prototype-messages`) à chaque message, uniquement sur l'appareil/navigateur utilisé. Un redémarrage du serveur ou un refresh de page ne fait donc plus perdre la conversation en cours. « Nouvelle conversation » l'efface explicitement. Les messages d'erreur réseau/API ne sont jamais persistés ni renvoyés au modèle — ils s'affichent localement puis disparaissent au message suivant.

## Code d'accès partagé (2026-08-22)

Ajouté pour permettre une mise en ligne publique sans exposer votre crédit API Anthropic à n'importe qui. Ce n'est **pas** une vraie authentification (pas de comptes, pas d'utilisateurs distincts) — juste un mot de passe unique, partagé entre toutes les personnes que vous invitez à tester l'app.

- Si `ACCESS_CODE` est défini dans `.env` (ou dans les variables d'environnement du serveur en production), le front affiche un écran demandant ce code avant d'autoriser le chat.
- Le code est vérifié **côté serveur** à chaque appel à `/api/chat` (comparaison directe, pas de hachage — suffisant pour ce niveau de protection, pas pour protéger un vrai secret). Toute requête sans le bon code reçoit une erreur 401.
- Le code saisi est stocké dans `localStorage` du navigateur pour ne pas le redemander à chaque visite.
- Si `ACCESS_CODE` n'est **pas** défini, l'app reste ouverte à tout le monde sans écran de code (comportement du prototype local jusqu'ici) — un avertissement s'affiche dans les logs serveur pour le rappeler.

## Déploiement public gratuit (Render.com)

Ces étapes sont **à faire vous-même** — création de compte, connexion GitHub et saisie de secrets ne sont pas des actions que l'agent doit effectuer à votre place.

1. **Créer un dépôt GitHub** pour ce dossier (`ombre-jungienne-app`), et y pousser le code.
   ```bash
   git init
   git add .
   git commit -m "Prototype initial"
   git branch -M main
   git remote add origin https://github.com/<votre-compte>/ombre-jungienne-app.git
   git push -u origin main
   ```
2. Créer un compte sur [render.com](https://render.com) (le niveau gratuit suffit).
3. Dans le tableau de bord Render : **New → Blueprint**, puis connecter le dépôt GitHub créé à l'étape 1. Render détecte automatiquement `render.yaml` à la racine du projet et propose de créer le service.
4. Render vous demandera de renseigner les variables marquées secrètes dans `render.yaml` (`sync: false`) :
   - `ANTHROPIC_API_KEY` : votre clé Anthropic.
   - `ACCESS_CODE` : le code que vous donnerez aux personnes autorisées à tester l'app. **Ne le laissez pas vide sur un déploiement public.**
5. Valider — Render construit et démarre le service. Au bout de quelques minutes, une URL publique du type `https://ombre-jungienne-app.onrender.com` est disponible.

**Limites du plan gratuit Render à connaître :** le service s'endort après un moment d'inactivité et met quelques secondes à se réveiller au premier message d'un visiteur — normal, pas un bug. Pour redéployer après une modification du code, il suffit de repousser sur `main` (`git push`) ; Render redéploie automatiquement.

## Sécurité

- La clé API ne quitte jamais le serveur (le front ne parle qu'à `/api/chat`, jamais directement à l'API Anthropic).
- Si `ANTHROPIC_API_KEY` est absente, le serveur démarre quand même (avec un avertissement en console) mais `/api/chat` renvoie une erreur claire plutôt que de planter.
- Le code d'accès protège contre l'usage opportuniste par des inconnus tombant sur l'URL, pas contre un attaquant déterminé (le code passe en clair dans une requête HTTPS classique, ce qui est suffisant pour ce cas d'usage mais ne remplace pas une vraie authentification).
