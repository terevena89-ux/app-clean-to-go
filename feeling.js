// =========================================================
// Le « feeling » de l'appli : vibrations et petits sons.
// Les réglages (vibration, son, thème, animations, vue) sont gardés sur CET appareil
// seulement (localStorage), pas synchronisés : le PC ne vibre pas, et on peut
// vouloir du son sur l'un et pas sur l'autre.
// =========================================================

const CLE = "clean-feeling";

// Par défaut : vibration et son activés (v0.2 : côté jeu), thème auto, animations complètes,
// vue « À faire », Pièces en liste, tâches propres repliées
let reglages = { vibration: true, son: true, theme: "auto", animations: "balatro", ecran: "leger", vue: "afaire", colonnes: "liste", propres: "fermees" };
try { Object.assign(reglages, JSON.parse(localStorage.getItem(CLE)) || {}); } catch (e) { /* on garde les valeurs par défaut */ }

export function lireReglage(nom) { return reglages[nom]; }
export function changerReglage(nom, valeur) {
  reglages[nom] = valeur;
  try { localStorage.setItem(CLE, JSON.stringify(reglages)); } catch (e) { /* stockage bloqué : tant pis */ }
}

// Le téléphone sait-il vibrer ? (Chrome Android oui ; PC non)
export const peutVibrer = typeof navigator !== "undefined" && "vibrate" in navigator;

// L'utilisateur a-t-il demandé « moins d'animations » dans les réglages du tel ?
const moinsAnimations = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
// Trois niveaux : « simples » (presque rien), « completes » (effets quand on fait une tâche),
// « balatro » (en plus : cadres qui flottent, penchent, brillent, arrivent comme des cartes...)
export function animationsCompletes() { return reglages.animations !== "simples" && !moinsAnimations(); }
export function modeBalatro() { return reglages.animations === "balatro" && !moinsAnimations(); }

// ---------- Vibration ----------
// Un nombre = durée en millisecondes ; une liste = vibre, pause, vibre...
function vibrer(motif) {
  if (!reglages.vibration || !peutVibrer) return;
  try { navigator.vibrate(motif); } catch (e) { /* ignoré */ }
}

// ---------- Son ----------
// Petits sons fabriqués sur place (pas de fichier audio à télécharger)
let audio = null;
function note(freq, depart, duree, forme = "sine", volume = 0.06) {
  if (!reglages.son) return;
  try {
    audio = audio || new AudioContext();
    const t = audio.currentTime + depart;
    const osc = audio.createOscillator(), gain = audio.createGain();
    osc.type = forme; osc.frequency.value = freq;
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duree);
    osc.connect(gain).connect(audio.destination);
    osc.start(t); osc.stop(t + duree);
  } catch (e) { /* pas de son possible : tant pis */ }
}

// ---------- Les moments de l'appli ----------
export function tacheFaite() {
  vibrer([15, 40, 25]);
  note(784, 0, 0.08, "square", 0.05); note(1047, 0.07, 0.08, "square", 0.05); note(1319, 0.14, 0.2, "square", 0.05);
}
export function tacheRepoussee() { vibrer(20); note(520, 0, 0.12); }
export function seuilAtteint() { vibrer(8); }   // la ligne glissée dépasse le seuil : « ça va valider »
export function attrape() { vibrer(12); }
export function lache() { vibrer(8); }
export function cran() { vibrer(6); }
// Bip du compteur de la jauge : chaque point gagné sonne un peu plus aigu que le précédent
export function bip(i) { vibrer(4); note(520 + i * 45, 0, 0.05, "square", 0.035); }
// Pièce (ou maison) à 100 % : petit jingle 8-bit qui monte + grosse vibration « ta-da-dam »
export function pieceComplete() {
  vibrer([30, 60, 30, 60, 140]);
  [523, 659, 784, 1047, 1319].forEach((f, i) => note(f, i * 0.09, i === 4 ? 0.35 : 0.14, "square", 0.05));
}
export function essai() { vibrer(15); note(2100, 0, 0.03, "sine", 0.05); }
