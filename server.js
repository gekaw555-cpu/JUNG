import "dotenv/config";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

const SYSTEM_PROMPT = fs.readFileSync(
  path.join(__dirname, "system_prompt.md"),
  "utf-8"
);

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

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
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
