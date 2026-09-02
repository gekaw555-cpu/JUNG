import "dotenv/config";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildContextBlock } from "./rag.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

const SYSTEM_PROMPT = fs.readFileSync(
  path.join(__dirname, "system_prompt.md"),
  "utf-8"
);

// Combien des derniers messages (utilisateur + agent) servent de requête pour
// la recherche RAG. Inclure les réponses de l'agent, pas seulement les
// messages utilisateur, donne une requête plus riche : une réponse courte de
// l'utilisateur ("fiable, sociable, ambitieux") ne porte presque aucun terme
// exploitable seule, alors que le tour précédent de l'agent contient déjà le
// thème exact de l'échange.
const RAG_QUERY_TURNS = 4;
const RAG_TOP_K = 6;

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
const API_KEY = process.env.ANTHROPIC_API_KEY;
const ACCESS_CODE = process.env.ACCESS_CODE || "";

if (!API_KEY) {
  console.warn(
    "⚠️  ANTHROPIC_API_KEY n'est pas définie (voir .env.example). Les appels au modèle échoueront."
  );
}
if (!ACCESS_CODE) {
  console.warn(
    "⚠️  ACCESS_CODE n'est pas définie : l'app est ouverte à tout le monde sans protection. Ok en local, à définir avant tout déploiement public (voir .env.example)."
  );
}

// Indique au front si un code d'accès est requis, sans jamais renvoyer le code
// lui-même. Utile pour n'afficher l'écran de code que quand c'est nécessaire.
app.get("/api/config", (req, res) => {
  res.json({ accessCodeRequired: Boolean(ACCESS_CODE) });
});

app.post("/api/chat", async (req, res) => {
  try {
    const { messages } = req.body;

    if (ACCESS_CODE && req.get("x-access-code") !== ACCESS_CODE) {
      return res.status(401).json({ error: "Code d'accès manquant ou incorrect." });
    }
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "Le champ messages[] est requis." });
    }
    if (!API_KEY) {
      return res
        .status(500)
        .json({ error: "ANTHROPIC_API_KEY manquante côté serveur (voir .env.example)." });
    }

    // RAG : recherche dans grille_exercices_ombre.md à partir des derniers
    // messages de l'utilisateur, pour donner à l'agent un accès en direct au
    // fichier de référence complet (~132 600 mots) plutôt qu'au seul résumé
    // condensé de system_prompt.md. Échoue silencieusement (log seulement) —
    // un souci de RAG ne doit jamais empêcher l'agent de répondre.
    let systemForThisTurn = SYSTEM_PROMPT;
    try {
      const queryText = messages
        .slice(-RAG_QUERY_TURNS)
        .map((m) =>
          Array.isArray(m.content)
            ? m.content.map((b) => b.text ?? "").join(" ")
            : m.content
        )
        .join("\n");
      const contextBlock = buildContextBlock(queryText, RAG_TOP_K);
      if (contextBlock) {
        systemForThisTurn = SYSTEM_PROMPT + "\n\n---\n\n" + contextBlock;
      }
    } catch (ragErr) {
      console.warn("⚠️  RAG : recherche échouée pour ce tour, on continue sans.", ragErr.message);
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        // 1024 coupait régulièrement les réponses au milieu d'un mot une fois
        // le system prompt enrichi (réponses plus étoffées et plus soutenues).
        max_tokens: 2048,
        system: systemForThisTurn,
        messages,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Erreur API Anthropic:", response.status, errText);
      return res
        .status(502)
        .json({ error: "Erreur en contactant l'API Anthropic.", detail: errText });
    }

    const data = await response.json();
    const text = (data.content ?? []).map((block) => block.text ?? "").join("");
    res.json({ text });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Prototype "Révéler l'Ombre" — http://localhost:${PORT}`);
});
