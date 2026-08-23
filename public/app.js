const chatEl = document.getElementById("chat");
const formEl = document.getElementById("composer");
const inputEl = document.getElementById("input");
const resetBtn = document.getElementById("reset");
const sendBtn = formEl.querySelector("button[type=submit]");
const micBtn = document.getElementById("mic");
const micErrorEl = document.getElementById("mic-error");
const ttsToggleBtn = document.getElementById("tts-toggle");

const gateEl = document.getElementById("gate");
const gateFormEl = document.getElementById("gate-form");
const gateInputEl = document.getElementById("gate-input");
const gateErrorEl = document.getElementById("gate-error");
const appMainEl = document.getElementById("app-main");

const STORAGE_KEY = "ombre-prototype-messages";
const ACCESS_CODE_KEY = "ombre-prototype-access-code";

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {
      // pas grave si ça échoue (ex. navigation privée) — l'app marche quand
      // même, juste sans installation ni mode hors-ligne pour la coquille.
    });
  });
}

// --- Entrée vocale (dictée) -------------------------------------------
// API native du navigateur, aucun service tiers, aucun coût. Support
// correct sur Chrome (desktop + Android) ; sur Safari iOS c'est partiel
// et parfois absent selon la version — le bouton reste alors caché.
const SpeechRecognitionCtor =
  window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
// Le navigateur coupe la reconnaissance après un silence ou une limite
// interne (souvent ~60s) même en mode "continuous". userWantsListening
// distingue "l'utilisateur veut toujours parler" (relance automatique)
// de "l'utilisateur a appuyé sur stop" (on arrête pour de vrai) — c'est
// ce qui donne, dans la pratique, une durée d'enregistrement illimitée.
let userWantsListening = false;
let finalTranscript = "";

if (SpeechRecognitionCtor) {
  micBtn.classList.remove("hidden");
  recognition = new SpeechRecognitionCtor();
  recognition.lang = "fr-FR";
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  recognition.addEventListener("start", () => {
    micBtn.classList.add("listening");
    micBtn.setAttribute("aria-pressed", "true");
    micErrorEl.classList.add("hidden");
  });

  recognition.addEventListener("result", (event) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) {
        finalTranscript += result[0].transcript + " ";
      } else {
        interim += result[0].transcript;
      }
    }
    inputEl.value = (finalTranscript + interim).trim();
  });

  recognition.addEventListener("error", (event) => {
    const messages = {
      "not-allowed": "Micro refusé — autorise l'accès dans les réglages du navigateur.",
      "no-speech": "Je n'ai rien entendu, réessaie.",
      "audio-capture": "Aucun micro détecté.",
    };
    // Ces deux erreurs ne se résoudront pas en réessayant tout seul.
    if (event.error === "not-allowed" || event.error === "audio-capture") {
      userWantsListening = false;
    }
    micErrorEl.textContent = messages[event.error] || "Erreur de reconnaissance vocale.";
    micErrorEl.classList.remove("hidden");
  });

  recognition.addEventListener("end", () => {
    if (userWantsListening) {
      // Coupure imposée par le navigateur, pas une vraie demande d'arrêt :
      // on relance directement, l'utilisateur n'a rien à refaire.
      try {
        recognition.start();
      } catch {
        // start() peut lever si un redémarrage est déjà en cours — sans
        // conséquence, un prochain cycle "end" retentera.
      }
    } else {
      micBtn.classList.remove("listening");
      micBtn.setAttribute("aria-pressed", "false");
    }
  });

  micBtn.addEventListener("click", () => {
    if (userWantsListening) {
      userWantsListening = false;
      recognition.stop();
    } else {
      userWantsListening = true;
      finalTranscript = inputEl.value ? `${inputEl.value} ` : "";
      stopSpeaking(); // évite que le micro capte la voix de l'app elle-même
      try {
        recognition.start();
      } catch {
        // déjà démarré — sans conséquence
      }
    }
  });
}

function stopListening() {
  if (userWantsListening) {
    userWantsListening = false;
    recognition.stop();
  }
}

// --- Sortie vocale (lecture des réponses) -------------------------------
// Idem : SpeechSynthesis native, gratuite, large support (Chrome + Safari,
// desktop + mobile). Désactivée par défaut, activable via le bouton 🔇/🔊.
const TTS_KEY = "ombre-prototype-tts";
const ttsSupported = "speechSynthesis" in window;
let ttsEnabled = ttsSupported && localStorage.getItem(TTS_KEY) === "on";

function stopSpeaking() {
  if (ttsSupported) window.speechSynthesis.cancel();
}

function speak(text) {
  if (!ttsSupported || !ttsEnabled) return;
  stopSpeaking();
  // Retire la syntaxe markdown pour une lecture naturelle.
  const plain = text
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^\s*-\s+/gm, "");
  const utterance = new SpeechSynthesisUtterance(plain);
  utterance.lang = "fr-FR";
  const frenchVoice = window.speechSynthesis
    .getVoices()
    .find((v) => v.lang?.startsWith("fr"));
  if (frenchVoice) utterance.voice = frenchVoice;
  window.speechSynthesis.speak(utterance);
}

function updateTtsButton() {
  ttsToggleBtn.textContent = ttsEnabled ? "🔊" : "🔇";
  ttsToggleBtn.setAttribute("aria-pressed", String(ttsEnabled));
  ttsToggleBtn.title = ttsEnabled
    ? "Lecture à voix haute activée (cliquer pour désactiver)"
    : "Lire les réponses à voix haute";
}

if (ttsSupported) {
  ttsToggleBtn.classList.remove("hidden");
  updateTtsButton();
  ttsToggleBtn.addEventListener("click", () => {
    ttsEnabled = !ttsEnabled;
    localStorage.setItem(TTS_KEY, ttsEnabled ? "on" : "off");
    if (!ttsEnabled) stopSpeaking();
    updateTtsButton();
  });
}

function getStoredAccessCode() {
  try {
    return localStorage.getItem(ACCESS_CODE_KEY) || "";
  } catch {
    return "";
  }
}

function setStoredAccessCode(code) {
  try {
    localStorage.setItem(ACCESS_CODE_KEY, code);
  } catch {
    // pas de stockage disponible — le code sera redemandé au prochain chargement
  }
}

function showGate(errorText) {
  appMainEl.classList.add("hidden");
  gateEl.classList.remove("hidden");
  if (errorText) {
    gateErrorEl.textContent = errorText;
    gateErrorEl.classList.remove("hidden");
  } else {
    gateErrorEl.classList.add("hidden");
  }
  gateInputEl.focus();
}

function showApp() {
  gateEl.classList.add("hidden");
  appMainEl.classList.remove("hidden");
}

async function initGate() {
  let accessCodeRequired = false;
  try {
    const res = await fetch("/api/config");
    const data = await res.json();
    accessCodeRequired = Boolean(data.accessCodeRequired);
  } catch {
    // si /api/config est injoignable, on tente quand même d'afficher l'appli ;
    // /api/chat renverra une erreur claire le cas échéant.
  }

  if (!accessCodeRequired || getStoredAccessCode()) {
    showApp();
  } else {
    showGate();
  }
}

gateFormEl.addEventListener("submit", (e) => {
  e.preventDefault();
  const code = gateInputEl.value.trim();
  if (!code) return;
  setStoredAccessCode(code);
  showApp();
});

/** @type {{role: "user" | "assistant", content: string}[]} */
let messages = loadMessages();

function loadMessages() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveMessages() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
  } catch {
    // stockage indisponible (navigation privée, quota...) — on continue sans persistance
  }
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Convertisseur markdown minimal (gras, italique, code inline, listes à
 * puces, paragraphes) — pas une lib complète, juste de quoi afficher
 * proprement ce que produit le system prompt (**gras**, listes "- item").
 * Le texte est échappé en HTML avant toute transformation, y compris pour
 * les messages de l'utilisateur, donc aucune injection possible.
 */
function renderMarkdownLite(text) {
  let html = escapeHtml(text);

  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");

  const lines = html.split("\n");
  const out = [];
  let inList = false;
  for (const line of lines) {
    const bulletMatch = line.match(/^\s*-\s+(.*)$/);
    if (bulletMatch) {
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push(`<li>${bulletMatch[1]}</li>`);
    } else {
      if (inList) {
        out.push("</ul>");
        inList = false;
      }
      out.push(line);
    }
  }
  if (inList) out.push("</ul>");
  html = out.join("\n");

  html = html
    .split(/\n{2,}/)
    .map((block) => (block.startsWith("<ul>") ? block : `<p>${block}</p>`))
    .join("");
  html = html.replace(/\n/g, "<br>");

  return html;
}

function render(errorText) {
  chatEl.innerHTML = "";
  for (const m of messages) {
    const div = document.createElement("div");
    div.className = `msg ${m.role}`;
    div.innerHTML = renderMarkdownLite(m.content);
    chatEl.appendChild(div);
  }
  if (errorText) {
    const div = document.createElement("div");
    div.className = "msg assistant error";
    div.textContent = `⚠️ ${errorText}`;
    chatEl.appendChild(div);
  }
  chatEl.scrollTop = chatEl.scrollHeight;
}

function addTypingIndicator() {
  const div = document.createElement("div");
  div.className = "msg assistant typing";
  div.id = "typing";
  div.textContent = "…";
  chatEl.appendChild(div);
  chatEl.scrollTop = chatEl.scrollHeight;
}

function removeTypingIndicator() {
  document.getElementById("typing")?.remove();
}

async function send(text) {
  stopSpeaking();
  messages.push({ role: "user", content: text });
  saveMessages();
  render();
  addTypingIndicator();
  sendBtn.disabled = true;

  let errorText = null;

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-access-code": getStoredAccessCode(),
      },
      body: JSON.stringify({ messages }),
    });
    const data = await res.json();
    removeTypingIndicator();

    if (res.status === 401) {
      // code d'accès manquant/incorrect (ex. supprimé côté serveur, ou jamais
      // saisi) : on retire le dernier message pas encore répondu, on efface le
      // code stocké et on rebascule sur l'écran de code.
      messages.pop();
      saveMessages();
      setStoredAccessCode("");
      sendBtn.disabled = false;
      render();
      showGate(data.error || "Code d'accès incorrect.");
      return;
    }

    if (!res.ok) {
      // erreur applicative (clé manquante, API Anthropic en erreur...) : on ne
      // l'ajoute pas à l'historique envoyé au modèle, juste affichée localement.
      errorText = data.error || "Erreur inconnue.";
    } else {
      const reply = data.text || "(réponse vide)";
      messages.push({ role: "assistant", content: reply });
      saveMessages();
      speak(reply);
    }
  } catch (err) {
    removeTypingIndicator();
    errorText = "Impossible de contacter le serveur.";
  }

  sendBtn.disabled = false;
  render(errorText);
}

formEl.addEventListener("submit", (e) => {
  e.preventDefault();
  stopListening();
  const text = inputEl.value.trim();
  if (!text) return;
  inputEl.value = "";
  send(text);
});

resetBtn.addEventListener("click", () => {
  stopSpeaking();
  messages = [];
  saveMessages();
  render();
});

render();
initGate();
