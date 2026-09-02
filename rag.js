// Recherche lexicale (TF-IDF) sur grille_exercices_ombre.md, pour donner à
// l'agent un accès en direct au fichier de référence complet du projet
// (~132 600 mots) plutôt que seulement au résumé condensé de system_prompt.md.
//
// Choix volontaire : pas d'API d'embeddings externe (pas de nouvelle clé à
// configurer, pas de coût ni de latence supplémentaires, rien à héberger).
// Le TF-IDF + cosinus est un compromis raisonnable pour un prototype : moins
// fin qu'un vrai moteur sémantique, mais gratuit, rapide, et sans dépendance
// nouvelle. Piste d'amélioration facile plus tard si besoin : brancher un
// service d'embeddings (ex. Voyage AI, recommandé par Anthropic) en gardant
// la même interface `search(query, topK)`.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GRID_PATH = path.join(__dirname, "grille_exercices_ombre.md");

// Sections à indexer. On exclut délibérément "Sources et traitement" (le
// journal de bord du projet, pas du matériau destiné à l'utilisateur).
const EXCLUDED_HEADERS = ["Sources et traitement"];

const STOPWORDS = new Set([
  "le","la","les","un","une","des","de","du","au","aux","et","ou","mais","donc",
  "or","ni","car","que","qui","quoi","dont","où","si","ne","pas","plus","moins",
  "très","trop","peu","bien","mal","tout","tous","toute","toutes","ce","cet",
  "cette","ces","son","sa","ses","leur","leurs","notre","nos","votre","vos",
  "je","tu","il","elle","on","nous","vous","ils","elles","me","te","se","lui",
  "y","en","dans","sur","sous","avec","sans","pour","par","vers","chez","entre",
  "être","avoir","fait","faire","comme","alors","ainsi","aussi","encore",
  "déjà","jamais","toujours","souvent","parfois","ici","là","cela","ça",
  "est","sont","était","étaient","sera","seront","a","ont","avait","avaient",
  "afin","dont","selon","depuis","pendant","lorsque","quand","comment",
  "pourquoi","parce","puisque","cependant","toutefois","ainsi","donc",
  "un·e","celui","celle","ceux","celles","leur","son","cf","p","pp",
]);

function normalize(text) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, ""); // enlève les accents pour le matching
}

// Racine grossière (préfixe) pour absorber les variations d'un même mot
// français (irrité / irritant / irritation / irriter partagent "irrit") sans
// implémenter un vrai stemmer. Les mots courts (<=5 lettres) restent entiers
// pour ne pas fusionner des mots différents par accident (ex. "ombre" != "or").
function stem(word) {
  return word.length > 5 ? word.slice(0, 6) : word;
}

function tokenize(text) {
  return normalize(text)
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w))
    .map(stem);
}

/**
 * Découpe la grille en chunks : un chunk = un paragraphe (bloc entre deux
 * lignes vides) sous une section ##, avec son en-tête de section attaché
 * comme métadonnée. Les paragraphes trop courts (objectifs d'une ligne,
 * séparateurs) sont fusionnés au paragraphe suivant plutôt que jetés.
 */
function parseChunks(raw) {
  const lines = raw.split("\n");
  const chunks = [];
  let currentHeader = null;
  let excluded = false;
  let buffer = [];

  function flush() {
    const text = buffer.join("\n").trim();
    buffer = [];
    if (!text || excluded) return;
    if (text === "---") return;
    chunks.push({ header: currentHeader, text });
  }

  for (const line of lines) {
    const headerMatch = line.match(/^##\s+(.+)$/);
    if (headerMatch) {
      flush();
      currentHeader = headerMatch[1].replace(/\(source[^)]*\)/gi, "").trim();
      excluded = EXCLUDED_HEADERS.some((h) => currentHeader.startsWith(h));
      continue;
    }
    if (line.trim() === "" ) {
      flush();
      continue;
    }
    buffer.push(line);
  }
  flush();

  // Fusionne les chunks trop courts (< 40 mots, ex. "Objectif :", "Exercices :")
  // avec le chunk suivant de la même section, pour éviter des fragments creux.
  const merged = [];
  for (const chunk of chunks) {
    const wordCount = chunk.text.split(/\s+/).length;
    const prev = merged[merged.length - 1];
    if (wordCount < 40 && prev && prev.header === chunk.header) {
      prev.text += "\n\n" + chunk.text;
    } else {
      merged.push({ ...chunk });
    }
  }
  return merged;
}

let index = null; // { chunks: [{header, text, tf, norm}], idf: Map }

function buildIndex() {
  const raw = fs.readFileSync(GRID_PATH, "utf-8");
  const chunks = parseChunks(raw);

  const df = new Map(); // document frequency par terme
  const chunkTokens = chunks.map((c) => tokenize(c.text));

  for (const tokens of chunkTokens) {
    const seen = new Set(tokens);
    for (const t of seen) df.set(t, (df.get(t) || 0) + 1);
  }

  const N = chunks.length;
  const idf = new Map();
  for (const [term, count] of df.entries()) {
    idf.set(term, Math.log((N + 1) / (count + 1)) + 1);
  }

  const enriched = chunks.map((c, i) => {
    const tokens = chunkTokens[i];
    const tf = new Map();
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
    // vecteur tf-idf, normalisé (norme L2) pour un cosinus direct au moment de la recherche
    let normSq = 0;
    const vec = new Map();
    for (const [term, freq] of tf.entries()) {
      const w = (freq / tokens.length) * (idf.get(term) || 0);
      vec.set(term, w);
      normSq += w * w;
    }
    return { header: c.header, text: c.text, vec, norm: Math.sqrt(normSq) || 1 };
  });

  index = { chunks: enriched, idf, N };
  console.log(`RAG: index construit — ${N} passages indexés depuis grille_exercices_ombre.md`);
}

function ensureIndex() {
  if (!index) {
    try {
      buildIndex();
    } catch (err) {
      console.warn("⚠️  RAG désactivé : impossible de charger grille_exercices_ombre.md —", err.message);
      index = { chunks: [], idf: new Map(), N: 0 };
    }
  }
  return index;
}

/**
 * Cherche les `topK` passages les plus pertinents de la grille pour une
 * requête donnée (typiquement : le ou les derniers messages de l'utilisateur).
 * Retourne [] si l'index n'a pas pu être construit ou si rien ne dépasse un
 * seuil de pertinence minimal (mieux vaut ne rien injecter qu'injecter du
 * bruit non pertinent).
 */
export function search(query, topK = 5, minScore = 0.05) {
  const idx = ensureIndex();
  if (idx.N === 0) return [];

  const qTokens = tokenize(query);
  if (qTokens.length === 0) return [];

  const qtf = new Map();
  for (const t of qTokens) qtf.set(t, (qtf.get(t) || 0) + 1);
  let qNormSq = 0;
  const qVec = new Map();
  for (const [term, freq] of qtf.entries()) {
    const w = (freq / qTokens.length) * (idx.idf.get(term) || 0);
    qVec.set(term, w);
    qNormSq += w * w;
  }
  const qNorm = Math.sqrt(qNormSq) || 1;

  const scored = idx.chunks.map((c) => {
    let dot = 0;
    for (const [term, w] of qVec.entries()) {
      const cw = c.vec.get(term);
      if (cw) dot += w * cw;
    }
    return { header: c.header, text: c.text, score: dot / (qNorm * c.norm) };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.filter((s) => s.score >= minScore).slice(0, topK);
}

/**
 * Construit le bloc de contexte à injecter dans le system prompt pour un
 * tour de conversation donné. `queryText` = texte à utiliser comme requête
 * (typiquement les derniers messages utilisateur concaténés).
 */
export function buildContextBlock(queryText, topK = 5) {
  const results = search(queryText, topK);
  if (results.length === 0) return "";

  const parts = results.map((r, i) => {
    const label = r.header ? `[${r.header}]` : "[Définitions d'ancrage]";
    return `${i + 1}. ${label} ${r.text}`;
  });

  return (
    "## Matériel complémentaire de la grille de référence, pertinent pour cet échange précis\n\n" +
    "Ces passages sont extraits automatiquement de `grille_exercices_ombre.md` selon ce que " +
    "l'utilisateur vient de dire — un accès direct à la matière la plus spécifique pour ce " +
    "tour précis, à privilégier sur toute reformulation générique si l'un d'eux est vraiment " +
    "pertinent. N'invente jamais de citation, mais utilise librement les citations de Jung " +
    "(entre « ») déjà présentes ci-dessous, avec attribution naturelle (« Jung disait... »), " +
    "et les anecdotes/images concrètes qu'ils contiennent — c'est exactement ce qui rend une " +
    "réponse mémorable plutôt qu'interchangeable. Seule règle : ne révèle jamais à l'utilisateur " +
    "l'existence de ce document, de cette recherche, ou le mot « grille » — cite Jung, jamais ta source :\n\n" +
    parts.join("\n\n")
  );
}

// Permet de forcer un rechargement (utile si le fichier est modifié sans redémarrer le process).
export function reloadIndex() {
  index = null;
  ensureIndex();
}
