# Prototype — Agent « Révéler l'Ombre »

Prototype web minimal pour **tester le comportement conversationnel de l'agent** avant d'investir dans une vraie app mobile. Ce n'est pas un aperçu du design final de l'app — juste un banc d'essai.

## Architecture

```
ombre-jungienne-app/
├── server.js           # serveur Express : sert le front + proxy vers l'API Anthropic
├── system_prompt.md     # copie figée du system prompt verrouillé (source : scratchpad system_prompt_agent_ombre.md)
├── public/
│   ├── index.html        # écran de chat unique
│   ├── style.css
│   └── app.js             # logique front : historique en mémoire, appels à /api/chat
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
