// =========================================================
// Clean to go — le « cerveau » de l'appli.
// Plan du fichier :
//   1. Réglages de base, données et calcul des dates
//   2. Stockage (Firebase, ou mode démo local)
//   3. Navigation entre les écrans
//   4. Affichage de chaque écran
//   5. Actions (fait, plus tard, pause, ajouter, supprimer...)
//   6. Glisser (la ligne qui suit le doigt)
//   7. Export / import Excel
//   8. Démarrage
// =========================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, onSnapshot, setDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import { chargerExcelJS, ajouterFeuille, telechargerClasseur, lireClasseur, lireFeuille } from "./excel-style.js";
import {
  lireReglage, changerReglage, peutVibrer, animationsCompletes,
  tacheFaite, tacheRepoussee, seuilAtteint, attrape, lache, cran, essai, bip, pieceComplete, modeBalatro
} from "./feeling.js";

// ---------- 1. Réglages de base et données ----------

const VERSION = "v1.1.0";
const NOM_APPLI = "app-clean-to-go";   // nom du dossier dans Firestore et des fichiers Excel

// Les 8 couleurs possibles pour une pièce (mêmes que dans Stuff to go)
const COULEURS = ["jaune", "bleu", "vert", "corail", "rose", "violet", "turquoise", "gris"];

// Toutes les données tiennent dans un seul objet « etat » :
//   pieces : mes pièces, dans l'ordre d'affichage     [{ id, nom, couleur }]
//   taches : mes tâches de ménage                      [{ id, nom, piece, freq, fait, report, histo }]
//            freq   = tous les combien (nombre), unite = "j", "sem" ou "mois"
//                     (ex. freq 2 + unite "sem" = toutes les 2 semaines)
//            fait   = dernière fois faite ("AAAA-MM-JJ"), ou null si jamais
//            report = nouvelle échéance choisie avec « Plus tard » ("AAAA-MM-JJ"), ou null
//            histo  = les dernières dates où elle a été faite (la plus récente d'abord, 30 max)
//   pause  : date de début de la pause ("AAAA-MM-JJ"), ou null si pas en pause.
//            Pendant la pause, l'appli fait comme si on était toujours ce jour-là :
//            les barres ne bougent plus. À la reprise, toutes les dates avancent d'autant.
const PIECES_DEPART = [
  { id: "cuisine", nom: "Cuisine", couleur: "jaune" },
  { id: "salle-de-bain", nom: "Salle de bain", couleur: "bleu" },
  { id: "salon", nom: "Salon", couleur: "vert" },
  { id: "chambre", nom: "Chambre", couleur: "violet" }
];
let etat = etatVide();
function etatVide() { return { pieces: structuredClone(PIECES_DEPART), taches: [], pause: null }; }

// Remet d'aplomb des données venues d'ailleurs (Firebase, ancienne version, fichier Excel...)
function normaliser(d) {
  const tableau = v => Array.isArray(v) ? v : [];
  const dateOk = v => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
  return {
    pieces: tableau(d.pieces).map((p, i) => ({ ...p, couleur: COULEURS.includes(p.couleur) ? p.couleur : COULEURS[i % 8] })),
    taches: tableau(d.taches).map(t => ({
      id: t.id, nom: String(t.nom || ""), piece: t.piece || "",
      ...convertirFreq(Math.max(1, parseInt(t.freq, 10) || 7), UNITES[t.unite] ? t.unite : "j"),
      fait: dateOk(t.fait), report: dateOk(t.report),
      histo: tableau(t.histo).filter(dateOk)
    })),
    pause: dateOk(d.pause)
  };
}

const nouvelId = () => Math.random().toString(36).slice(2, 10);
const $ = id => document.getElementById(id);
const PLANCHE = "icones/tabler.svg#";
// Texte simplifié pour la recherche : minuscules, sans accents (« Évier » = « evier »)
const simplifier = t => String(t).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
// Transforme l'état en texte, toujours dans le même ordre : sert à voir si quelque chose a vraiment changé.
const enTexte = v => JSON.stringify(v, (k, x) =>
  x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort()) : x);

const trouverTache = id => etat.taches.find(t => t.id === id);
const SANS_PIECE = { id: "?", nom: "Sans pièce", couleur: "gris" };
const trouverPiece = id => etat.pieces.find(p => p.id === id) || SANS_PIECE;

// --- Dates ---
// Une date est rangée en texte « AAAA-MM-JJ ». Pour compter les jours, on la transforme
// en « numéro de jour » (nombre de jours depuis 1970) : la différence de deux numéros = l'écart en jours.
const aujourdhui = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const numero = s => Math.round(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 864e5);
const enDate = n => new Date(n * 864e5).toISOString().slice(0, 10);
const courte = s => `${s.slice(8, 10)}/${s.slice(5, 7)}`;              // « 07/11 »
const longue = s => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`; // « 07/11/2026 »
// Le « jour de référence » : aujourd'hui, ou le jour de début de la pause (le temps est gelé)
const jourRef = () => etat.pause || aujourdhui();

// --- Fréquences : jours, semaines ou mois ---
const UNITES = { j: "j", sem: "sem.", mois: "mois" };
const MAX_FREQ = { j: 365, sem: 52, mois: 24 };
const texteFreq = t => `${t.freq} ${UNITES[t.unite] || "j"}`;
// Conversion automatique des jours « ronds » : 30, 60, 90 j → 1, 2, 3 mois ;
// 7, 14, 21 j → 1, 2, 3 sem. ; 15 j → 2 sem. (Excel, lui, garde tout en jours.)
function convertirFreq(freq, unite) {
  if (unite !== "j") return { freq, unite };
  if (freq % 30 === 0) return { freq: freq / 30, unite: "mois" };
  if (freq === 15) return { freq: 2, unite: "sem" };
  if (freq % 7 === 0) return { freq: freq / 7, unite: "sem" };
  return { freq, unite };
}
// Fréquence en jours, pour Excel (1 mois = 30 j, 1 sem. = 7 j)
const enJours = t => t.freq * (t.unite === "mois" ? 30 : t.unite === "sem" ? 7 : 1);
// Ajoute la fréquence d'une tâche à un jour (numéro de jour).
// En mois, on garde le même jour du mois (7 nov. → 7 fév.) ; un 31 qui n'existe pas
// devient le dernier jour du mois (31 janv. + 1 mois → 28 ou 29 fév.).
function plusFreq(n, t) {
  if (t.unite === "mois") {
    const d = new Date(n * 864e5), jour = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + t.freq);
    const dernier = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(jour, dernier));
    return Math.round(d / 864e5);
  }
  return n + t.freq * (t.unite === "sem" ? 7 : 1);
}
// Longueur d'un « tour » de la tâche, en jours (sert à remplir la barre de vie)
const duree = t => t.fait ? plusFreq(numero(t.fait), t) - numero(t.fait)
  : t.freq * (t.unite === "mois" ? 30 : t.unite === "sem" ? 7 : 1);

// Échéance d'une tâche (numéro de jour) : la date choisie avec « Plus tard » s'il y en a une,
// sinon dernière fois + fréquence. Jamais faite = à faire tout de suite.
const echeance = t => t.report ? numero(t.report) : t.fait ? plusFreq(numero(t.fait), t) : numero(jourRef());
// Jours restants avant l'échéance (négatif = en retard)
const reste = t => echeance(t) - numero(jourRef());
// Vie de la tâche, de 1 (toute propre) à 0 (à faire) : c'est la barre de vie
const vie = t => Math.max(0, Math.min(1, reste(t) / duree(t)));
// Tâche « propre » : barre encore remplie à 70 % ou plus. Elle est grisée et rangée
// sous la ligne repliable « › N tâches propres », pour laisser la place à ce qui presse.
const SEUIL_PROPRE = 0.7;
const estPropre = t => vie(t) >= SEUIL_PROPRE;
const classeVie = v => v > 0.5 ? "ok" : v > 0.2 ? "moyen" : "bas";
const joursCourt = r => r > 0 ? r + " j" : r === 0 ? "auj." : "+" + -r + " j";
const joursLong = r => r > 1 ? `dans ${r} j` : r === 1 ? "demain" : r === 0 ? "aujourd'hui" : `retard ${-r} j`;
// Score « maison propre » : moyenne des barres de vie, en %
const score = taches => taches.length ? Math.round(taches.reduce((s, t) => s + vie(t), 0) / taches.length * 100) : 100;
// Tri par urgence : la plus en retard d'abord
const parUrgence = (a, b) => reste(a) - reste(b) || vie(a) - vie(b) || a.nom.localeCompare(b.nom, "fr");

// ---------- 2. Stockage ----------
// Mode démo (adresse se terminant par ?demo) : données gardées dans ce navigateur seulement.
const MODE_DEMO = new URLSearchParams(location.search).has("demo");

let refDoc = null;          // emplacement de mes données dans Firestore
let auth = null;
let dernierJSON = "";       // pour ne pas tout redessiner si rien n'a changé

// Enregistre l'état. Firestore garde l'écriture en attente si on est hors ligne,
// et l'envoie tout seul au retour du réseau. La dernière modification gagne.
function sauver() {
  dernierJSON = enTexte(etat);
  if (MODE_DEMO) {
    try { localStorage.setItem("clean-demo", dernierJSON); } catch (e) { /* stockage plein ou bloqué */ }
    return;
  }
  if (!refDoc) return;
  setDoc(refDoc, { ...etat, maj: serverTimestamp() }).catch(err => {
    console.error(err);
    afficherToast("Échec de l'enregistrement", null);
  });
}

function demarrerFirebase() {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  // Cache local permanent : l'appli fonctionne hors ligne avec la dernière copie connue
  const db = initializeFirestore(app, {
    ignoreUndefinedProperties: true,
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
  });
  onAuthStateChanged(auth, user => {
    if (!user) { montrer("connexion"); return; }
    $("compte-info").textContent = `Connecté : ${user.displayName || user.email}`;
    // Mes données : users/{mon uid}/app-clean-to-go/donnees
    refDoc = doc(db, "users", user.uid, NOM_APPLI, "donnees");
    onSnapshot(refDoc, { includeMetadataChanges: true }, snap => {
      majSynchro(snap.metadata);
      if (!snap.exists()) {
        // Première utilisation : données de départ. Seulement si la réponse vient vraiment
        // du serveur, sinon on risquerait d'écraser mes vraies données en étant hors ligne.
        if (!snap.metadata.fromCache) { etat = etatVide(); sauver(); router(); }
        return;
      }
      const recu = normaliser(snap.data());
      const json = enTexte(recu);
      if (json === dernierJSON) return; // rien de neuf (souvent : mon propre enregistrement)
      etat = recu;
      dernierJSON = json;
      router();
    });
  });
}

function demarrerDemo() {
  try { etat = normaliser(JSON.parse(localStorage.getItem("clean-demo")) || etatVide()); }
  catch (e) { etat = etatVide(); }
  $("compte-info").textContent = "Mode démo : données gardées sur cet appareil seulement.";
  majSynchro(null);
  router();
}

async function seConnecter() {
  const fournisseur = new GoogleAuthProvider();
  $("connexion-erreur").hidden = true;
  try {
    await signInWithPopup(auth, fournisseur);
  } catch (err) {
    // Si la fenêtre de connexion est bloquée, on passe par une redirection
    if (err.code === "auth/popup-blocked" || err.code === "auth/operation-not-supported-in-this-environment") {
      signInWithRedirect(auth, fournisseur);
    } else if (err.code !== "auth/popup-closed-by-user" && err.code !== "auth/cancelled-popup-request") {
      $("connexion-erreur").textContent = "Connexion impossible : " + err.message;
      $("connexion-erreur").hidden = false;
    }
  }
}

// Indicateur de synchro (Réglages → Compte) : synchronisé / en attente / hors ligne
let metaSynchro = null;
function majSynchro(meta) {
  if (meta !== undefined) metaSynchro = meta;
  let classe = "ok", ic = "cloud-check", texte = "Synchronisé";
  if (!navigator.onLine) { classe = "off"; ic = "cloud-off"; texte = "Hors ligne : envoi au retour du réseau"; }
  else if (metaSynchro && metaSynchro.hasPendingWrites) { classe = "attente"; ic = "cloud-up"; texte = "En attente d'envoi"; }
  if (MODE_DEMO) { classe = "off"; ic = "cloud-off"; texte = "Mode démo : pas de synchro"; }
  document.querySelectorAll(".synchro").forEach(el => {
    el.className = "synchro " + classe;
    el.querySelector("use").setAttribute("href", PLANCHE + ic);
  });
  $("synchro-texte").textContent = texte;
}
window.addEventListener("online", () => majSynchro());
window.addEventListener("offline", () => majSynchro());

// ---------- 3. Navigation ----------
// Chaque écran a son adresse (#reglages, #theme, #pieces) : le bouton « retour »
// du téléphone ramène à l'écran précédent, comme dans une vraie appli.

let ecranActuel = "";
let aNavigue = false; // a-t-on changé d'écran depuis l'ouverture ?
function aller(adresse) { aNavigue = true; location.hash = adresse; }
function retour() { if (aNavigue) history.back(); else location.replace("#"); }

function montrer(nom) {
  document.querySelectorAll(".ecran").forEach(e => { e.hidden = e.id !== "ecran-" + nom; });
  if (ecranActuel !== nom) {
    window.scrollTo(0, 0);
    // Petite transition : le nouvel écran glisse depuis la droite (depuis la gauche au retour)
    const e = $("ecran-" + nom);
    if (ecranActuel && animationsCompletes()) {
      e.classList.remove("entre-droite", "entre-gauche");
      void e.offsetWidth; // force le navigateur à relancer l'animation
      e.classList.add(nom === "accueil" ? "entre-gauche" : "entre-droite");
    }
  }
  ecranActuel = nom;
}

function router() {
  if (!MODE_DEMO && !refDoc) return; // pas encore connecté
  majBoutonsRanger();
  const h = location.hash.slice(1);
  if (h === "reglages") { afficherReglages(); montrer("reglages"); }
  else if (h === "theme") { afficherReglages(); montrer("theme"); }
  else if (h === "pieces") { afficherPieces(); montrer("pieces"); }
  else {
    if (ecranActuel !== "accueil") arrivee = "distribue"; // on revient sur l'écran principal : on redistribue
    afficherAccueil(); montrer("accueil");
  }
  // Une fiche ouverte se met à jour (ex. modification arrivée de l'autre appareil)
  if (ficheOuverte) afficherFiche();
}
window.addEventListener("hashchange", () => {
  modeRanger = false;
  fermerFenetres();
  router();
});

// ---------- 4. Affichage ----------

function icone(nom, classe = "") {
  return `<svg class="ic ${classe}"><use href="${PLANCHE}${nom}"></use></svg>`;
}
// Protège le texte tapé avant de l'afficher (évite qu'un « < » casse la page)
function echapper(t) {
  return String(t).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Mode « Modifier » : l'ajout, les croix et la modification n'apparaissent qu'après
// avoir touché le bouton crayon (évite les fausses manips). Il se coupe en changeant d'écran.
let modeRanger = false;
function majBoutonsRanger() {
  document.querySelectorAll("[data-ranger]").forEach(b => {
    b.classList.toggle("actif", modeRanger);
    b.innerHTML = modeRanger ? "OK" : icone(b.dataset.ranger === "modifier" ? "pencil-plus" : "arrows-sort");
  });
}

let rechercheOuverte = false;
let dernierFait = null;   // tâche qu'on vient de faire (pour l'animation de la barre qui se recharge)

// Barre de vie (petite, sur la ligne)
function barreVie(t) {
  const r = reste(t), v = vie(t);
  // Échéance aujourd'hui : un tout petit bout de barre, pour la distinguer d'une tâche en retard
  const largeur = r < 0 ? 0 : Math.max(v * 100, 4);
  return `<span class="vie"><i class="${classeVie(v)}" style="width:${largeur}%"></i></span>`;
}

// Une ligne de tâche. En mode normal : un « rail » avec les actions derrière (Fait / Plus tard)
// et la ligne devant, qu'on fait glisser. En mode Modifier : fréquence + croix.
function ligneTache(t, avecCarre, grise = false) {
  const p = trouverPiece(t.piece);
  const carre = avecCarre ? `<span class="carre coul-${p.couleur}" title="${echapper(p.nom)}"></span>` : "";
  if (modeRanger) {
    return `<div class="glissiere" data-tache="${t.id}"><div class="tache">${carre}
      <span class="nom">${echapper(t.nom)}</span><span class="freq">${texteFreq(t)}</span>
      <button class="btn-icone retirer" data-suppr="${t.id}" aria-label="Supprimer">${icone("x")}</button></div></div>`;
  }
  const r = reste(t);
  const anim = dernierFait === t.id && animationsCompletes() ? " vient-fait" : "";
  return `<div class="glissiere${anim}${grise ? " propre" : ""}${r < 0 ? " en-retard" : ""}" data-tache="${t.id}">
    <div class="derriere derriere-fait">${icone("check")}Fait</div>
    <div class="derriere derriere-tard">Plus tard${icone("clock")}</div>
    <div class="tache">${carre}<span class="nom">${echapper(t.nom)}</span>
      <span class="jours${r < 0 ? " retard" : ""}">${joursCourt(r)}</span>${barreVie(t)}</div></div>`;
}

function afficherAccueil() {
  const vue = lireReglage("vue") === "pieces" ? "pieces" : "afaire";
  document.querySelectorAll("[data-vue]").forEach(b => b.setAttribute("aria-pressed", b.dataset.vue === vue));
  // Pause
  $("bandeau-pause").hidden = !etat.pause;
  if (etat.pause) $("pause-texte").textContent = "En pause depuis le " + courte(etat.pause);
  $("btn-pause").classList.toggle("actif", !!etat.pause);
  // Jauge « maison propre » (le chiffre tangue doucement, façon jeu, en animations complètes)
  const pct = score(etat.taches);
  $("jauge-remplie").style.width = pct + "%";
  $("jauge-remplie").className = classeVie(pct / 100);
  $("jauge-pct").textContent = pct + " %";
  $("jauge-pct").classList.toggle("tangue", animationsCompletes());
  // Mini-barres : une par pièce (seulement les pièces qui ont des tâches), sur 2 colonnes
  $("barres-pieces").innerHTML = etat.pieces.map(p => {
    const ts = etat.taches.filter(t => t.piece === p.id);
    if (!ts.length) return "";
    const s = score(ts);
    return `<div class="mini" data-mini="${p.id}"><span class="carre coul-${p.couleur}"></span>
      <span class="nom">${echapper(p.nom)}</span><span class="vie"><i class="${classeVie(s / 100)}" style="width:${s}%"></i></span></div>`;
  }).join("");
  // Recherche
  $("zone-recherche").hidden = !rechercheOuverte;
  $("btn-recherche").classList.toggle("actif", rechercheOuverte);
  const q = rechercheOuverte ? simplifier($("recherche").value.trim()) : "";
  const garde = t => !q || simplifier(t.nom + " " + trouverPiece(t.piece).nom).includes(q);
  const ajout = piece => modeRanger
    ? `<button class="ligne-ajout" data-ajouter="${piece || ""}">${icone("plus")}Ajouter une tâche</button>` : "";

  // Les lignes d'une boîte : d'abord ce qui presse, puis la ligne repliable « › N tâches propres »
  // (dépliée : les tâches propres, grisées). En mode Modifier ou pendant une recherche, tout est visible.
  const ouvertes = lireReglage("propres") === "ouvertes";
  const lignes = (taches, avecCarre) => {
    if (modeRanger || q) return taches.map(t => ligneTache(t, avecCarre)).join("");
    const aFaire = taches.filter(t => !estPropre(t)), propres = taches.filter(estPropre);
    let h = aFaire.map(t => ligneTache(t, avecCarre)).join("");
    if (propres.length) {
      h += `<button class="ligne-propres${ouvertes ? " ouvert" : ""}" data-replier>${icone("chevron-right")}
        <span class="nom">${propres.length} tâche${propres.length > 1 ? "s" : ""} propre${propres.length > 1 ? "s" : ""}</span></button>`;
      if (ouvertes) h += propres.map(t => ligneTache(t, avecCarre, true)).join("");
    }
    return h;
  };

  let html = "";
  // Mode 2 colonnes (Réglages) : seulement pour la vue Pièces
  $("liste-taches").classList.toggle("aff-colonnes", vue === "pieces" && lireReglage("colonnes") === "2col");
  if (vue === "afaire") {
    // Une seule boîte : toutes les tâches, la plus urgente en haut
    const liste = etat.taches.filter(garde).sort(parUrgence);
    html = `<div class="boite" style="--i:0">${lignes(liste, true)}
      ${!liste.length && !modeRanger ? `<p class="vide">${q ? "Rien trouvé" : "Aucune tâche"}</p>` : ""}${ajout("")}</div>`;
  } else {
    // Une boîte par pièce (avec son propre %), puis les tâches sans pièce s'il y en a
    const groupes = [...etat.pieces, SANS_PIECE].map(p => ({
      p, taches: etat.taches.filter(t => (trouverPiece(t.piece).id === p.id) && garde(t)).sort(parUrgence),
      toutes: etat.taches.filter(t => trouverPiece(t.piece).id === p.id)
    })).filter(g => g.p.id === "?" ? g.taches.length : (!q || g.taches.length));
    // --i = numéro du cadre : décale ses mouvements (flotter, reflet, distribution) par rapport aux voisins
    html = groupes.map((g, i) => `<div class="boite" data-boite="${g.p.id}" style="--i:${i}">
      <h2 class="titre-section coul-${g.p.couleur}"><span class="nom">${echapper(g.p.nom)}</span><span>${g.toutes.length ? score(g.toutes) + " %" : ""}</span></h2>
      ${lignes(g.taches, false)}${g.p.id === "?" ? "" : ajout(g.p.id)}</div>`).join("")
      || `<p class="vide">Rien trouvé</p>`;
  }
  $("liste-taches").innerHTML = html;
  dernierFait = null;
  // Arrivée des cadres façon cartes (mode Balatro) : distribués à l'ouverture, retournés au changement d'onglet
  if (arrivee && modeBalatro()) {
    document.querySelectorAll("#liste-taches .boite").forEach(b => b.classList.add(arrivee));
  }
  arrivee = null;
}
// Prochaine arrivée de cadres à animer : "distribue" (ouverture) ou "retourne" (onglet), ou rien
let arrivee = "distribue";

// --- Réglages ---
const NOMS_THEMES = { auto: "Auto", clair: "Clair", sombre: "Sombre" };
function afficherReglages() {
  $("version").textContent = VERSION;
  $("nb-pieces").textContent = String(etat.pieces.length).padStart(2, "0");
  $("theme-actuel").textContent = NOMS_THEMES[lireReglage("theme")] || "Auto";
  $("ligne-vibration").hidden = !peutVibrer;
  document.querySelectorAll("[data-feeling]").forEach(b => b.setAttribute("aria-pressed", lireReglage(b.dataset.feeling)));
  document.querySelectorAll("[data-theme-choix]").forEach(b => b.setAttribute("aria-pressed", b.dataset.themeChoix === lireReglage("theme")));
  document.querySelectorAll("[data-anim-choix]").forEach(b => b.setAttribute("aria-pressed", b.dataset.animChoix === lireReglage("animations")));
  document.querySelectorAll("[data-ecran-choix]").forEach(b => b.setAttribute("aria-pressed", b.dataset.ecranChoix === (lireReglage("ecran") || "aucun")));
  document.querySelectorAll("[data-colonnes-choix]").forEach(b => b.setAttribute("aria-pressed", b.dataset.colonnesChoix === (lireReglage("colonnes") || "liste")));
}

// --- Mes pièces ---
function afficherPieces() {
  $("liste-pieces").innerHTML = etat.pieces.map(p => {
    const nb = etat.taches.filter(t => t.piece === p.id).length;
    return `<div class="piece" data-piece="${p.id}">
      <div class="ligne">
        ${modeRanger ? `<span class="poignee" aria-label="Déplacer">${icone("grip-vertical")}</span>` : `<span class="carre coul-${p.couleur}"></span>`}
        <input class="p-nom" value="${echapper(p.nom)}" aria-label="Nom de la pièce">
        <span class="nb">${String(nb).padStart(2, "0")}</span>
        <button class="btn-icone" data-suppr-piece="${p.id}" aria-label="Supprimer">${icone("trash")}</button>
      </div>
      ${modeRanger ? "" : `<div class="nuancier">${COULEURS.map(k =>
        `<button type="button" class="coul-${k} ${k === p.couleur ? "choisie" : ""}" data-couleur="${k}" aria-label="Couleur ${k}"></button>`).join("")}</div>`}
    </div>`;
  }).join("");
}

// ---------- 5. Actions ----------

// Message en bas de l'écran pendant 5 secondes, avec un bouton « Annuler » optionnel
let minuteurToast = null;
let actionAnnuler = null;
function afficherToast(texte, annuler) {
  $("toast-texte").textContent = texte;
  $("toast-annuler").hidden = !annuler;
  actionAnnuler = annuler;
  $("toast").hidden = false;
  clearTimeout(minuteurToast);
  minuteurToast = setTimeout(() => { $("toast").hidden = true; actionAnnuler = null; }, 5000);
}
$("toast-annuler").addEventListener("click", () => {
  if (actionAnnuler) actionAnnuler();
  $("toast").hidden = true;
});

// Fait un changement en gardant une photo de l'état d'avant, pour pouvoir
// tout remettre si j'appuie sur « Annuler ».
function avecAnnulation(texte, action) {
  const avant = structuredClone(etat);
  action();
  sauver();
  router();
  afficherToast(texte, () => { etat = avant; sauver(); router(); });
}

// Tâche faite (aujourd'hui) : la barre se remplit, l'échéance repart de zéro
// « origine » = l'endroit de l'écran d'où partent les effets (la ligne glissée, ou le bouton Fait).
function marquerFait(id, origine) {
  const t = trouverTache(id);
  if (!t) return;
  // On note les scores AVANT, pour savoir combien on a gagné (et si une pièce passe à 100 %)
  const avant = { maison: score(etat.taches), piece: scorePiece(t.piece) };
  tacheFaite();
  dernierFait = id;
  avecAnnulation(`« ${t.nom} » fait`, () => {
    const j = jourRef();
    t.fait = j;
    t.report = null;
    t.histo = [j, ...t.histo.filter(x => x !== j)].slice(0, 30);
  });
  if (animationsCompletes()) feteFait(t, origine, avant);
}
const scorePiece = id => score(etat.taches.filter(x => trouverPiece(x.piece).id === trouverPiece(id).id));

// Plus tard : repousse l'échéance de n jours (à partir d'aujourd'hui si elle est déjà dépassée)
function reporter(id, n, origine) {
  const t = trouverTache(id);
  if (!t) return;
  tacheRepoussee();
  avecAnnulation(`« ${t.nom} » repoussé de ${n} j`, () => {
    t.report = enDate(Math.max(echeance(t), numero(jourRef())) + n);
  });
  if (animationsCompletes() && origine) volant(`+${n} j`, origine, { x: origine.x, y: origine.y - 70 }, "jaune");
}

// ---------- Les effets « façon jeu » (seulement en Animations : Complètes) ----------
// Calque transparent posé sur tout l'écran, où naissent confettis et chiffres volants.
const centreDe = el => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
const PASTELS = ["#FAC775", "#97C459", "#85B7EB", "#ED93B1", "#F0997B", "#AFA9EC", "#5DCAA5"];

// Confettis : de petits carrés colorés qui jaillissent puis retombent (gravité)
function confettis(o, nombre) {
  for (let i = 0; i < nombre; i++) {
    const c = document.createElement("i");
    c.className = "confetti";
    c.style.cssText = `left:${o.x}px;top:${o.y}px;background:${PASTELS[i % PASTELS.length]}`;
    $("effets").appendChild(c);
    const angle = Math.random() * Math.PI * 2, force = 60 + Math.random() * 110;
    c.animate([
      { transform: "translate(-50%,-50%) rotate(0)" },
      { transform: `translate(${Math.cos(angle) * force}px, ${Math.sin(angle) * force + 90}px) rotate(${Math.random() * 540}deg)`, opacity: 0 }
    ], { duration: 700 + Math.random() * 500, easing: "cubic-bezier(.2,.6,.4,1)" }).onfinish = () => c.remove();
  }
}
// Texte qui s'envole d'un point à un autre (« +3 % » vers la jauge, « +2 j »...) : il gonfle, tangue, puis file
function volant(texte, de, vers, couleur = "vert") {
  const s = document.createElement("span");
  s.className = "volant " + couleur;
  s.textContent = texte;
  s.style.cssText = `left:${de.x}px;top:${de.y}px`;
  $("effets").appendChild(s);
  s.animate([
    { transform: "translate(-50%,-50%) scale(.5)", opacity: 1 },
    { transform: "translate(-50%,-130%) scale(1.5) rotate(-8deg)", opacity: 1, offset: .35 },
    { transform: `translate(calc(-50% + ${vers.x - de.x}px), calc(-50% + ${vers.y - de.y}px)) scale(.7)`, opacity: .2 }
  ], { duration: 950, easing: "cubic-bezier(.5,0,.8,.6)" }).onfinish = () => s.remove();
}
// Petite secousse de l'écran, comme un coup de manette
function secousse() {
  $("ecran-accueil").animate([
    { transform: "translate(0,0)" }, { transform: "translate(-4px,2px)" }, { transform: "translate(4px,-2px)" },
    { transform: "translate(-3px,-1px)" }, { transform: "translate(2px,2px)" }, { transform: "translate(0,0)" }
  ], { duration: 280 });
}
// Un élément « saute » (gros, penché, puis revient) : chiffres, mini-barres...
function saute(el, fort = 1.4) {
  if (el) el.animate([{ transform: "scale(1)" }, { transform: `scale(${fort}) rotate(-5deg)` }, { transform: "scale(.92) rotate(3deg)" }, { transform: "scale(1)" }],
    { duration: 320, easing: "cubic-bezier(.3,1.6,.5,1)" });
}
// La jauge compte de l'ancien score au nouveau, un point à la fois, avec un bip
// de plus en plus aigu à chaque point (comme les scores qui grimpent dans Balatro)
let minuteurCompte = null;
function compterJauge(de, a) {
  clearTimeout(minuteurCompte);
  if (a <= de) return;
  const pas = Math.max(25, Math.min(90, 700 / (a - de)));
  let actuel = de, i = 0;
  const avance = () => {
    actuel++; i++;
    $("jauge-pct").textContent = actuel + " %";
    $("jauge-remplie").style.width = actuel + "%";
    bip(i);
    saute($("jauge-pct"), 1.35);
    if (actuel < a) minuteurCompte = setTimeout(avance, pas);
  };
  $("jauge-pct").textContent = de + " %";
  $("jauge-remplie").style.width = de + "%";
  minuteurCompte = setTimeout(avance, 420); // on attend que le « +X % » arrive à la jauge
}
// Grande bannière en tampon (« CUISINE 100 % ») : jingle, grosse vibration, pluie de confettis
function banniere(texte) {
  const b = document.createElement("div");
  b.className = "banniere";
  b.innerHTML = `<span>${echapper(texte)}</span>`;
  $("effets").appendChild(b);
  b.firstChild.animate([
    { transform: "scale(3) rotate(-30deg)", opacity: 0 },
    { transform: "scale(.9) rotate(-6deg)", opacity: 1, offset: .6 },
    { transform: "scale(1) rotate(-8deg)", opacity: 1 }
  ], { duration: 380, easing: "ease-out", fill: "forwards" });
  pieceComplete();
  confettis({ x: innerWidth / 2, y: innerHeight * 0.4 }, 70);
  setTimeout(() => b.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300 }).onfinish = () => b.remove(), 1500);
}
// Toute la fête d'une tâche faite
function feteFait(t, origine, avant) {
  const o = origine || centreDe($("jauge-pct"));
  const maison = score(etat.taches), piece = scorePiece(t.piece);
  confettis(o, 34);
  secousse();
  const gain = maison - avant.maison;
  volant(gain > 0 ? `+${gain} %` : "OK", o, centreDe($("jauge-pct")));
  compterJauge(avant.maison, maison);
  // La mini-barre de la pièce et la ligne « tâches propres » sautent aussi
  setTimeout(() => {
    saute(document.querySelector(`[data-mini="${trouverPiece(t.piece).id}"]`), 1.15);
    saute(document.querySelector(`[data-boite="${trouverPiece(t.piece).id}"] .ligne-propres`) || document.querySelector(".ligne-propres"), 1.08);
  }, 500);
  if (piece === 100 && avant.piece < 100) {
    setTimeout(() => banniere(`${trouverPiece(t.piece).nom} 100 %`), 1000);
    // Mode Balatro : le cadre de la pièce brille d'un grand reflet
    setTimeout(() => {
      const b = document.querySelector(`[data-boite="${trouverPiece(t.piece).id}"]`);
      if (b && modeBalatro()) { b.classList.remove("brille"); void b.offsetWidth; b.classList.add("brille"); }
    }, 1100);
  }
  else if (maison === 100 && avant.maison < 100) setTimeout(() => banniere("Maison 100 %"), 1000);
}

function supprimerTache(id) {
  const t = trouverTache(id);
  if (!t) return;
  avecAnnulation("Tâche supprimée", () => { etat.taches = etat.taches.filter(x => x.id !== id); });
}

// Pause (vacances) : le temps s'arrête. À la reprise, toutes les dates avancent du nombre
// de jours de pause, comme si ces jours n'avaient pas existé.
$("btn-pause").addEventListener("click", () => {
  if (etat.pause) { reprendre(); return; }
  avecAnnulation("Pause : compteurs gelés", () => { etat.pause = aujourdhui(); });
});
$("btn-reprendre").addEventListener("click", reprendre);
function reprendre() {
  if (!etat.pause) return;
  avecAnnulation("Compteurs repartis", () => {
    const n = numero(aujourdhui()) - numero(etat.pause);
    const decale = s => s ? enDate(numero(s) + n) : s;
    etat.taches.forEach(t => { t.fait = decale(t.fait); t.report = decale(t.report); });
    etat.pause = null;
  });
}

// --- Écran principal ---
document.querySelectorAll("[data-vue]").forEach(b => b.addEventListener("click", () => {
  if (lireReglage("vue") !== b.dataset.vue) arrivee = "retourne";
  changerReglage("vue", b.dataset.vue);
  afficherAccueil();
}));
$("btn-recherche").addEventListener("click", () => {
  rechercheOuverte = !rechercheOuverte;
  if (!rechercheOuverte) $("recherche").value = "";
  afficherAccueil();
  if (rechercheOuverte) $("recherche").focus();
});
$("recherche").addEventListener("input", afficherAccueil);
document.querySelectorAll("[data-ranger]").forEach(b => b.addEventListener("click", () => {
  modeRanger = !modeRanger;
  router();
}));

let ignorerClic = false; // vrai juste après un glisser : le doigt levé ne doit pas « toucher » la ligne
$("liste-taches").addEventListener("click", e => {
  if (ignorerClic) return;
  const suppr = e.target.closest("[data-suppr]");
  if (suppr) { supprimerTache(suppr.dataset.suppr); return; }
  const ajout = e.target.closest("[data-ajouter]");
  if (ajout) { ouvrirEdition(null, ajout.dataset.ajouter); return; }
  // Ligne « › N tâches propres » : déplie / replie (réglage gardé sur cet appareil)
  if (e.target.closest("[data-replier]")) {
    changerReglage("propres", lireReglage("propres") === "ouvertes" ? "fermees" : "ouvertes");
    cran();
    afficherAccueil();
    return;
  }
  const rail = e.target.closest("[data-tache]");
  if (!rail) return;
  if (modeRanger) ouvrirEdition(rail.dataset.tache);
  else ouvrirFiche(rail.dataset.tache);
});

// --- Fenêtres ---
let ficheOuverte = null;      // id de la tâche dont la mini-fiche est ouverte
let tardPour = null;          // id de la tâche à repousser
let brouillon = null;         // tâche en cours d'ajout / de modification
let rechargementEnAttente = false;

function fermerFenetres() {
  document.querySelectorAll(".fenetre").forEach(f => { f.hidden = true; });
  ficheOuverte = tardPour = brouillon = null;
  // Une nouvelle version attendait qu'aucune fiche ne soit ouverte : c'est le moment
  if (rechargementEnAttente) location.reload();
}
const fenetreOuverte = () => [...document.querySelectorAll(".fenetre")].some(f => !f.hidden);
document.querySelectorAll(".fenetre").forEach(f => f.addEventListener("click", e => {
  // Toucher le fond sombre (à côté de la boîte) ou une croix ferme la fenêtre.
  // (Sauf le « clic » envoyé en levant le doigt à la fin d'un glisser : il tomberait
  // sur le fond de la fenêtre « Plus tard » qui vient de s'ouvrir.)
  if (ignorerClic) return;
  if (e.target === f || e.target.closest("[data-fermer]")) fermerFenetres();
}));

// Mini-fiche : Fait / Plus tard, historique, menu ⋯ (Modifier / Supprimer)
function ouvrirFiche(id) {
  ficheOuverte = id;
  $("fiche-menu-choix").hidden = true;
  afficherFiche();
  $("fenetre-fiche").hidden = false;
}
function afficherFiche() {
  const t = trouverTache(ficheOuverte);
  if (!t) { fermerFenetres(); return; }
  const p = trouverPiece(t.piece);
  const r = reste(t), v = vie(t);
  $("fiche-titre").className = `fenetre-titre coul-${p.couleur}`;
  $("fiche-nom").textContent = t.nom;
  $("fiche-detail").textContent = `${p.nom} · tous les ${texteFreq(t)}${t.report ? " · repoussé" : ""}`;
  $("fiche-vie").className = classeVie(v);
  $("fiche-vie").style.width = (r < 0 ? 0 : Math.max(v * 100, 4)) + "%";
  $("fiche-jours").textContent = joursLong(r);
  $("fiche-jours").style.color = r < 0 ? "var(--danger)" : "";
  $("fiche-histo").textContent = t.histo.length ? t.histo.map(longue).join(" · ") : "Jamais faite";
}
$("fiche-menu").addEventListener("click", () => { $("fiche-menu-choix").hidden = !$("fiche-menu-choix").hidden; });
$("fiche-fait").addEventListener("click", () => { const id = ficheOuverte, o = centreDe($("fiche-fait")); fermerFenetres(); marquerFait(id, o); });
$("fiche-tard").addEventListener("click", () => { const id = ficheOuverte; fermerFenetres(); ouvrirTard(id); });
$("fiche-modifier").addEventListener("click", () => { const id = ficheOuverte; fermerFenetres(); ouvrirEdition(id); });
$("fiche-supprimer").addEventListener("click", () => { const id = ficheOuverte; fermerFenetres(); supprimerTache(id); });

// Plus tard : choix du nombre de jours
function ouvrirTard(id) {
  const t = trouverTache(id);
  if (!t) return;
  tardPour = id;
  origineTard = null;
  $("tard-titre").textContent = "Plus tard : " + t.nom;
  $("fenetre-tard").hidden = false;
}
$("tard-choix").addEventListener("click", e => {
  const b = e.target.closest("[data-jours]");
  if (!b) return;
  const id = tardPour, o = origineTard || centreDe(b);
  fermerFenetres();
  reporter(id, +b.dataset.jours, o);
});
let origineTard = null; // d'où part le « +2 j » (la ligne glissée)

// Ajouter / modifier une tâche
function ouvrirEdition(id, piece) {
  const t = id && trouverTache(id);
  brouillon = t
    ? { id: t.id, nom: t.nom, piece: t.piece, freq: t.freq, unite: t.unite, fait: t.fait || "" }
    : { id: null, nom: "", piece: piece || (etat.pieces[0] || {}).id || "", freq: 1, unite: "sem", fait: jourRef() };
  $("tache-titre").textContent = t ? "Modifier la tâche" : "Nouvelle tâche";
  $("ft-nom").value = brouillon.nom;
  $("ft-fait").value = brouillon.fait;
  $("ft-supprimer").hidden = !t;
  afficherEdition();
  $("fenetre-tache").hidden = false;
  if (!t) $("ft-nom").focus();
}
function afficherEdition() {
  $("ft-piece").innerHTML = etat.pieces.map(p =>
    `<button type="button" class="coul-${p.couleur}" data-piece-choix="${p.id}" aria-pressed="${p.id === brouillon.piece}">${echapper(p.nom)}</button>`).join("");
  $("ft-freq").textContent = brouillon.freq;
  document.querySelectorAll("[data-unite]").forEach(b => b.setAttribute("aria-pressed", b.dataset.unite === brouillon.unite));
  document.querySelectorAll("[data-freq-fixe]").forEach(b => b.setAttribute("aria-pressed",
    +b.dataset.freqFixe === brouillon.freq && b.dataset.uniteFixe === brouillon.unite));
}
$("form-tache").addEventListener("click", e => {
  if (!brouillon) return;
  const p = e.target.closest("[data-piece-choix]");
  if (p) { brouillon.piece = p.dataset.pieceChoix; afficherEdition(); return; }
  const f = e.target.closest("[data-freq]");
  if (f) { brouillon.freq = Math.min(MAX_FREQ[brouillon.unite], Math.max(1, brouillon.freq + +f.dataset.freq)); afficherEdition(); return; }
  const u = e.target.closest("[data-unite]");
  if (u) { brouillon.unite = u.dataset.unite; brouillon.freq = Math.min(MAX_FREQ[brouillon.unite], brouillon.freq); afficherEdition(); return; }
  const ff = e.target.closest("[data-freq-fixe]");
  if (ff) { brouillon.freq = +ff.dataset.freqFixe; brouillon.unite = ff.dataset.uniteFixe; afficherEdition(); }
});
$("ft-supprimer").addEventListener("click", () => { const id = brouillon && brouillon.id; fermerFenetres(); if (id) supprimerTache(id); });
$("form-tache").addEventListener("submit", e => {
  e.preventDefault();
  const b = brouillon;
  const nom = $("ft-nom").value.trim();
  if (!b || !nom) return;
  const fait = /^\d{4}-\d{2}-\d{2}$/.test($("ft-fait").value) ? $("ft-fait").value : null;
  let t = b.id && trouverTache(b.id);
  if (!t) { t = { id: nouvelId(), histo: [], report: null, fait: null }; etat.taches.push(t); }
  t.nom = nom; t.piece = b.piece;
  Object.assign(t, convertirFreq(b.freq, b.unite)); // ex. « 14 j » devient « 2 sem. »
  // Date « Dernière fois » changée à la main : l'échéance repart de cette date
  if (fait !== t.fait) {
    t.fait = fait;
    t.report = null;
    if (fait && !t.histo.includes(fait)) t.histo = [...t.histo, fait].sort().reverse().slice(0, 30);
  }
  fermerFenetres();
  sauver();
  router();
});

// --- Réglages ---
document.querySelectorAll("[data-aller]").forEach(b => b.addEventListener("click", () => aller(b.dataset.aller)));
document.querySelectorAll("[data-retour]").forEach(b => b.addEventListener("click", retour));
$("btn-connexion").addEventListener("click", seConnecter);
$("reglages-feeling").addEventListener("click", e => {
  const b = e.target.closest("[data-feeling]");
  if (!b) return;
  changerReglage(b.dataset.feeling, !lireReglage(b.dataset.feeling));
  afficherReglages();
  essai(); // on sent / entend tout de suite le résultat
});
// Les attributs posés sur la page (data-anim, data-crt) servent au CSS pour allumer / couper les effets
function appliquerAnimations() {
  document.documentElement.dataset.anim = lireReglage("animations");
  document.documentElement.dataset.crt = lireReglage("ecran") || "aucun";
}
appliquerAnimations();
// Effet « vieil écran » (lignes de balayage + bords assombris) : Aucun / Léger / Fort
$("choix-ecran").addEventListener("click", e => {
  const b = e.target.closest("[data-ecran-choix]");
  if (!b) return;
  changerReglage("ecran", b.dataset.ecranChoix);
  appliquerAnimations();
  afficherReglages();
});
// Vue Pièces : en liste ou en 2 colonnes (réglage de cet appareil)
$("choix-colonnes").addEventListener("click", e => {
  const b = e.target.closest("[data-colonnes-choix]");
  if (!b) return;
  changerReglage("colonnes", b.dataset.colonnesChoix);
  afficherReglages();
});
$("choix-animations").addEventListener("click", e => {
  const b = e.target.closest("[data-anim-choix]");
  if (!b) return;
  changerReglage("animations", b.dataset.animChoix);
  appliquerAnimations();
  afficherReglages();
});
$("choix-theme").addEventListener("click", e => {
  const b = e.target.closest("[data-theme-choix]");
  if (!b) return;
  changerReglage("theme", b.dataset.themeChoix);
  window.appliquerTheme(b.dataset.themeChoix);
  afficherReglages();
});
$("btn-deconnexion").addEventListener("click", () => {
  if (MODE_DEMO) return;
  if (confirm("Se déconnecter ? Tes données restent en sécurité dans ton compte.")) signOut(auth).then(() => location.reload());
});

// --- Mes pièces ---
const couleurLibre = () => COULEURS.find(k => !etat.pieces.some(p => p.couleur === k)) || "gris";
$("form-piece").addEventListener("submit", e => {
  e.preventDefault();
  const nom = $("piece-nom").value.trim();
  if (!nom) return;
  etat.pieces.push({ id: nouvelId(), nom, couleur: couleurLibre() });
  $("piece-nom").value = "";
  sauver();
  afficherPieces();
});
$("liste-pieces").addEventListener("change", e => {
  const champ = e.target.closest(".p-nom");
  if (!champ) return;
  const p = etat.pieces.find(x => x.id === champ.closest("[data-piece]").dataset.piece);
  if (p && champ.value.trim()) { p.nom = champ.value.trim(); sauver(); }
  else afficherPieces(); // nom vidé : on remet l'ancien
});
$("liste-pieces").addEventListener("click", e => {
  const ligne = e.target.closest("[data-piece]");
  if (!ligne) return;
  const p = etat.pieces.find(x => x.id === ligne.dataset.piece);
  const coul = e.target.closest("[data-couleur]");
  if (coul && p) { p.couleur = coul.dataset.couleur; sauver(); afficherPieces(); return; }
  if (e.target.closest("[data-suppr-piece]") && p) {
    // La pièce part avec ses tâches (« Annuler » remet tout)
    const nb = etat.taches.filter(t => t.piece === p.id).length;
    avecAnnulation(nb ? `Pièce supprimée (${nb} tâche${nb > 1 ? "s" : ""})` : "Pièce supprimée", () => {
      etat.pieces = etat.pieces.filter(x => x.id !== p.id);
      etat.taches = etat.taches.filter(t => t.piece !== p.id);
    });
  }
});

// ---------- 6. Glisser ----------

// a) Glisser une tâche à droite (Fait) ou à gauche (Plus tard).
// La ligne suit le doigt ; derrière elle apparaît l'action. Au-delà d'un seuil
// (un tiers de la largeur), petite vibration : en lâchant, l'action se fait.
// En dessous du seuil, la ligne revient à sa place et rien ne se passe.
$("liste-taches").addEventListener("pointerdown", e => {
  if (modeRanger || e.button > 0) return;
  const ligne = e.target.closest(".tache");
  const rail = ligne && ligne.closest("[data-tache]");
  if (!rail) return;
  const doigt = e.pointerId;
  const x0 = e.clientX, y0 = e.clientY;
  const largeur = rail.offsetWidth;
  const seuil = Math.min(120, largeur / 3);
  const fondFait = rail.querySelector(".derriere-fait"), fondTard = rail.querySelector(".derriere-tard");
  let sens = null;    // null = pas encore décidé, "h" = on glisse la ligne, "v" = on fait défiler la page
  let dx = 0, depasse = false;

  const bouger = ev => {
    if (ev.pointerId !== doigt) return;
    dx = ev.clientX - x0;
    const dy = ev.clientY - y0;
    if (!sens) {
      // On attend quelques pixels pour savoir si le doigt part sur le côté ou vers le bas
      if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) {
        sens = "h";
        try { ligne.setPointerCapture(doigt); } catch (err) { /* pas grave */ }
        ligne.style.transition = "none";
      } else if (Math.abs(dy) > 8) { sens = "v"; finir(); return; }
      else return;
    }
    ev.preventDefault();
    // Mode Balatro : la ligne penche selon la vitesse du doigt, comme une carte qu'on tire
    if (modeBalatro()) {
      penche = penche * 0.7 + Math.max(-7, Math.min(7, (dx - dernierDx) * 0.5)) * 0.3;
      dernierDx = dx;
      ligne.style.transform = `translateX(${dx}px) rotate(${penche}deg)`;
    } else ligne.style.transform = `translateX(${dx}px)`;
    fondFait.style.visibility = dx > 0 ? "visible" : "hidden";
    fondTard.style.visibility = dx < 0 ? "visible" : "hidden";
    const d = Math.abs(dx) >= seuil;
    if (d !== depasse) { depasse = d; if (d) seuilAtteint(); }
    // Petits crans tous les 30 pixels (vibration légère), comme une molette
    const c = Math.floor(Math.abs(dx) / 30);
    if (c !== cranActuel) { cranActuel = c; if (!depasse) cran(); }
  };
  let cranActuel = 0, penche = 0, dernierDx = 0;
  const remettre = () => {
    ligne.style.transition = "transform .18s ease-out";
    ligne.style.transform = "";
    setTimeout(() => { fondFait.style.visibility = fondTard.style.visibility = ""; ligne.style.transition = ""; }, 200);
  };
  const finir = () => {
    document.removeEventListener("pointermove", bouger);
    document.removeEventListener("pointerup", lacherDoigt);
    document.removeEventListener("pointercancel", annulerDoigt);
  };
  const lacherDoigt = ev => {
    if (ev.pointerId !== doigt) return;
    finir();
    if (sens !== "h") return;
    // Le navigateur va envoyer un « clic » en levant le doigt : on l'ignore
    ignorerClic = true;
    setTimeout(() => { ignorerClic = false; }, 60);
    const id = rail.dataset.tache;
    // Point de départ des effets : le bout droit de la ligne (là où est la barre de vie)
    const r = rail.getBoundingClientRect();
    const origine = { x: r.right - 40, y: r.top + r.height / 2 };
    if (depasse && dx > 0) {
      // Fait : la ligne file vers la droite, puis la liste se redessine
      if (animationsCompletes()) {
        ligne.style.transition = "transform .16s ease-in";
        ligne.style.transform = `translateX(${largeur}px)`;
        setTimeout(() => marquerFait(id, origine), 160);
      } else marquerFait(id, origine);
    } else if (depasse && dx < 0) {
      remettre();
      ouvrirTard(id);
      origineTard = origine;
    } else remettre();
  };
  const annulerDoigt = ev => { if (ev.pointerId !== doigt) return; finir(); if (sens === "h") remettre(); };
  document.addEventListener("pointermove", bouger, { passive: false });
  document.addEventListener("pointerup", lacherDoigt);
  document.addEventListener("pointercancel", annulerDoigt);
});

// c) Mode Balatro : le cadre touché penche en 3D vers le doigt, comme une carte qu'on tient.
// (À la souris sur PC, il penche dès qu'on passe dessus.)
let cadrePenche = null;
function pencherCadre(b, x, y) {
  const r = b.getBoundingClientRect();
  const dx = (x - r.left) / r.width - 0.5, dy = (y - r.top) / r.height - 0.5;
  b.style.transform = `perspective(700px) rotateY(${dx * 10}deg) rotateX(${-dy * 10}deg) scale(1.015)`;
}
function redresserCadre() {
  if (!cadrePenche) return;
  cadrePenche.style.transform = "";
  cadrePenche = null;
}
$("liste-taches").addEventListener("pointerdown", e => {
  if (!modeBalatro() || cadreAttrape) return;
  const b = e.target.closest(".boite");
  if (!b) return;
  cadrePenche = b;
  pencherCadre(b, e.clientX, e.clientY);
});
$("liste-taches").addEventListener("pointermove", e => {
  if (!modeBalatro() || cadreAttrape) return;
  const b = e.target.closest(".boite");
  if (e.pointerType === "mouse" && b !== cadrePenche) { redresserCadre(); if (b) cadrePenche = b; }
  if (cadrePenche && (e.pointerType === "mouse" || e.buttons)) pencherCadre(cadrePenche, e.clientX, e.clientY);
});
["pointerup", "pointercancel", "pointerleave"].forEach(t => $("liste-taches").addEventListener(t, e => {
  if (t === "pointerleave" || e.pointerType !== "mouse") redresserCadre();
}));

// d) Appui long sur le bandeau d'une pièce (vue Pièces) : on attrape le cadre entier et on le
// déplace pour changer l'ordre des pièces. Il suit le doigt en se balançant selon la vitesse,
// les autres cadres s'écartent en douceur. Marche aussi en 2 colonnes.
let cadreAttrape = null;
$("liste-taches").addEventListener("pointerdown", e => {
  const bandeau = e.target.closest(".titre-section");
  const boite = bandeau && bandeau.closest(".boite[data-boite]");
  if (!boite || boite.dataset.boite === "?" || lireReglage("vue") !== "pieces") return;
  const doigt = e.pointerId, x0 = e.clientX, y0 = e.clientY;
  // On attend 400 ms sans bouger : si le doigt bouge avant, c'est qu'on fait défiler la page
  const attente = setTimeout(() => attraper(boite, doigt, x0, y0), 400);
  const annuler = ev => {
    if (ev.pointerId !== doigt) return;
    if (ev.type === "pointermove" && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 8) return;
    clearTimeout(attente);
    document.removeEventListener("pointermove", annuler);
    document.removeEventListener("pointerup", annuler);
    document.removeEventListener("pointercancel", annuler);
  };
  document.addEventListener("pointermove", annuler);
  document.addEventListener("pointerup", annuler);
  document.addEventListener("pointercancel", annuler);
});
// Pendant qu'on tient un cadre, on empêche la page de défiler sous le doigt
document.addEventListener("touchmove", e => { if (cadreAttrape) e.preventDefault(); }, { passive: false });
document.addEventListener("contextmenu", e => { if (cadreAttrape || e.target.closest(".titre-section")) e.preventDefault(); });

function attraper(boite, doigt, x0, y0) {
  redresserCadre();
  cadreAttrape = boite;
  attrape();
  const conteneur = $("liste-taches");
  const depart = boite.getBoundingClientRect();
  const prisA = { x: x0 - depart.left, y: y0 - depart.top }; // où le doigt tient le cadre
  let dernier = { x: x0, y: y0 }, balance = 0, dx = 0, dy = 0;
  boite.classList.add("attrape");
  boite.style.transition = "none"; // pas de retard : le cadre colle au doigt
  // Place le cadre pile sous le doigt (sa « vraie » place = sa position sans le décalage actuel)
  const suivre = () => {
    const r = boite.getBoundingClientRect();
    const vraie = { x: r.left - dx, y: r.top - dy };
    dx = dernier.x - prisA.x - vraie.x;
    dy = dernier.y - prisA.y - vraie.y;
    boite.style.transform = `translate(${dx}px, ${dy}px) rotate(${balance}deg) scale(1.05)`;
  };
  suivre();
  const voisins = () => [...conteneur.querySelectorAll(".boite[data-boite]")].filter(b => b !== boite);
  const deplacer = action => {
    cran();
    const avant = new Map(voisins().map(b => { const r = b.getBoundingClientRect(); return [b, { x: r.left, y: r.top }]; }));
    action();
    for (const [b, p] of avant) {
      const r = b.getBoundingClientRect();
      if (p.x !== r.left || p.y !== r.top)
        b.animate([{ transform: `translate(${p.x - r.left}px, ${p.y - r.top}px)` }, { transform: "none" }], { duration: 180, easing: "ease-out" });
    }
    suivre();
  };
  const bouger = ev => {
    if (ev.pointerId !== doigt) return;
    ev.preventDefault();
    // Balancement : le cadre penche dans le sens où il va, puis se redresse
    balance = balance * 0.75 + Math.max(-12, Math.min(12, (ev.clientX - dernier.x) * 0.8)) * 0.25;
    dernier = { x: ev.clientX, y: ev.clientY };
    if (ev.clientY < 80) window.scrollBy(0, -14);
    else if (ev.clientY > innerHeight - 80) window.scrollBy(0, 14);
    suivre();
    const sous = document.elementFromPoint(ev.clientX, ev.clientY);
    const cible = sous && sous.closest(".boite[data-boite]");
    if (!cible || cible === boite || cible.dataset.boite === "?" || !conteneur.contains(cible)) return;
    const r = cible.getBoundingClientRect();
    const apres = ev.clientY > r.top + r.height / 2;
    if (apres && cible.nextElementSibling !== boite) deplacer(() => cible.after(boite));
    else if (!apres && cible.previousElementSibling !== boite) deplacer(() => cible.before(boite));
  };
  const lacher = ev => {
    if (ev.pointerId !== doigt) return;
    document.removeEventListener("pointermove", bouger);
    document.removeEventListener("pointerup", lacher);
    document.removeEventListener("pointercancel", lacher);
    lache();
    ignorerClic = true;
    setTimeout(() => { ignorerClic = false; }, 60);
    // Le cadre se pose : il revient en douceur à sa nouvelle place, puis on enregistre l'ordre
    boite.style.transition = "transform .2s cubic-bezier(.3,1.5,.5,1)";
    boite.style.transform = "";
    setTimeout(() => {
      boite.classList.remove("attrape");
      boite.style.transition = "";
      cadreAttrape = null;
      const ordre = [...conteneur.querySelectorAll(".boite[data-boite]")].map(b => b.dataset.boite);
      etat.pieces.sort((a, b) => ordre.indexOf(a.id) - ordre.indexOf(b.id));
      sauver();
      afficherAccueil();
    }, 210);
  };
  document.addEventListener("pointermove", bouger, { passive: false });
  document.addEventListener("pointerup", lacher);
  document.addEventListener("pointercancel", lacher);
}

// b) Glisser-déposer pour réordonner (repris de Stuff to go) : la ligne attrapée par
// sa poignée suit le doigt pixel par pixel, les autres s'écartent en douceur.
function rendreTriable(conteneur, selecteur, auLacher) {
  conteneur.addEventListener("pointerdown", e => {
    const prise = e.target.closest(".poignee");
    const ligne = prise && prise.closest(selecteur);
    if (!ligne) return;
    e.preventDefault();
    const doigt = e.pointerId;
    // Où le doigt a attrapé la ligne : on garde ce décalage pour qu'elle reste « collée » au doigt
    const prisA = e.clientY - ligne.getBoundingClientRect().top;
    let decalage = 0;
    let dernierY = e.clientY;
    ligne.classList.add("glisse");
    ligne.style.pointerEvents = "none"; // pour « voir » la ligne qui est sous le doigt
    ligne.style.transition = "box-shadow .12s";
    attrape();
    const suivre = () => {
      const vraieHaut = ligne.getBoundingClientRect().top - decalage;
      decalage = dernierY - prisA - vraieHaut;
      ligne.style.transform = `translateY(${decalage}px) scale(1.03)`;
    };
    // Change la ligne de place, et fait glisser en douceur les voisines (technique « FLIP »)
    const voisines = () => [...conteneur.querySelectorAll(selecteur)].filter(x => x !== ligne);
    const deplacer = action => {
      cran();
      const avant = new Map(voisines().map(x => [x, x.getBoundingClientRect().top]));
      action();
      for (const [x, haut] of avant) {
        const ecart = haut - x.getBoundingClientRect().top;
        if (ecart) x.animate([{ transform: `translateY(${ecart}px)` }, { transform: "none" }], { duration: 160, easing: "ease-out" });
      }
      suivre();
    };
    const bouger = ev => {
      if (ev.pointerId !== doigt) return;
      ev.preventDefault();
      dernierY = ev.clientY;
      if (ev.clientY < 80) window.scrollBy(0, -14);
      else if (ev.clientY > innerHeight - 80) window.scrollBy(0, 14);
      suivre();
      const sous = document.elementFromPoint(ev.clientX, ev.clientY);
      const cible = sous && sous.closest(selecteur);
      if (!cible || cible === ligne || !conteneur.contains(cible)) return;
      const r = cible.getBoundingClientRect();
      const apres = ev.clientY > r.top + r.height / 2;
      if (apres && cible.nextElementSibling !== ligne) deplacer(() => cible.after(ligne));
      else if (!apres && cible.previousElementSibling !== ligne) deplacer(() => cible.before(ligne));
    };
    const lacher = ev => {
      if (ev.pointerId !== doigt) return;
      document.removeEventListener("pointermove", bouger);
      document.removeEventListener("pointerup", lacher);
      document.removeEventListener("pointercancel", lacher);
      lache();
      ligne.style.transition = "transform .15s ease-out";
      ligne.style.transform = "translateY(0) scale(1)";
      setTimeout(() => {
        ligne.classList.remove("glisse");
        ligne.style.transform = ligne.style.transition = ligne.style.pointerEvents = "";
        auLacher();
      }, 160);
    };
    document.addEventListener("pointermove", bouger, { passive: false });
    document.addEventListener("pointerup", lacher);
    document.addEventListener("pointercancel", lacher);
  });
}
// Mes pièces : l'ordre des pièces (c'est aussi l'ordre de la vue « Pièces »)
rendreTriable($("liste-pieces"), ".piece", () => {
  const ordre = [...$("liste-pieces").querySelectorAll(".piece")].map(el => el.dataset.piece);
  etat.pieces.sort((a, b) => ordre.indexOf(a.id) - ordre.indexOf(b.id));
  sauver();
  afficherPieces();
});

// ---------- 7. Export / import Excel ----------
// Feuille « Tâches » (une ligne par tâche) et feuille « Pièces » (ordre et couleur).
// Les dates sont écrites JJ/MM/AAAA, lisibles telles quelles.

$("btn-export").addEventListener("click", async () => {
  try {
    const ExcelJS = await chargerExcelJS();
    const classeur = new ExcelJS.Workbook();
    classeur.creator = "Clean to go";
    const ordre = etat.pieces.map(p => p.id);
    const rang = id => { const i = ordre.indexOf(id); return i < 0 ? 999 : i; };
    const lignes = [...etat.taches]
      .sort((a, b) => rang(a.piece) - rang(b.piece) || a.nom.localeCompare(b.nom, "fr"))
      .map(t => ({
        piece: trouverPiece(t.piece).id === "?" ? "" : trouverPiece(t.piece).nom,
        tache: t.nom, freq: enJours(t),
        fait: t.fait ? longue(t.fait) : "", report: t.report ? longue(t.report) : "",
        histo: t.histo.map(longue).join(", ")
      }));
    ajouterFeuille(classeur, "Tâches", [
      { header: "Pièce", key: "piece", width: 18 },
      { header: "Tâche", key: "tache", width: 30 },
      { header: "Tous les (jours)", key: "freq", width: 16 },
      { header: "Dernière fois", key: "fait", width: 15 },
      { header: "Repoussée au", key: "report", width: 15 },
      { header: "Historique", key: "histo", width: 60 }
    ], lignes);
    ajouterFeuille(classeur, "Pièces", [
      { header: "Ordre", key: "ordre", width: 8 },
      { header: "Pièce", key: "piece", width: 22 },
      { header: "Couleur", key: "couleur", width: 12 }
    ], etat.pieces.map((p, i) => ({ ordre: i + 1, piece: p.nom, couleur: p.couleur })));
    await telechargerClasseur(classeur, NOM_APPLI);
  } catch (err) {
    afficherToast("Export impossible : " + err.message, null);
  }
});

// Lit une date écrite à la main ou par Excel : « 07/11/2026 », « 7/11/26 », « 2026-11-07 »...
function lireDate(texte) {
  const t = String(texte || "").trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) return `${m[3].length === 2 ? "20" + m[3] : m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  const d = t ? new Date(t) : null; // ex. date au format anglais renvoyée par Excel
  if (d && !isNaN(d)) return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return null;
}

// Lit une fréquence écrite dans Excel : « 3 j », « 2 sem. », « 1 mois », ou juste « 14 » (= jours,
// comme dans les fichiers de la v0.1). Renvoie { freq, unite }.
function lireFreq(texte) {
  const m = String(texte || "").trim().toLowerCase().match(/^(\d+)\s*([a-zé]*)/);
  const nb = m ? parseInt(m[1], 10) : 7;
  const mot = m ? m[2] : "";
  const unite = mot.startsWith("s") ? "sem" : mot.startsWith("m") ? "mois" : "j";
  return convertirFreq(Math.min(MAX_FREQ[unite], Math.max(1, nb || 1)), unite);
}

$("btn-import").addEventListener("click", () => $("fichier-import").click());
$("fichier-import").addEventListener("change", async e => {
  const fichier = e.target.files[0];
  e.target.value = ""; // pour pouvoir réimporter le même fichier plus tard
  if (!fichier) return;
  if (!confirm("Remplacer toutes tes pièces et tes tâches par le contenu de ce fichier ?")) return;
  try {
    const classeur = await lireClasseur(fichier);
    const lignesTaches = lireFeuille(classeur.getWorksheet("Tâches"));
    const lignesPieces = lireFeuille(classeur.getWorksheet("Pièces"));
    if (!lignesTaches.length && !lignesPieces.length) throw new Error("feuille « Tâches » introuvable ou vide");

    // Les pièces : on réutilise les identifiants existants quand le nom correspond
    const pieces = [];
    const memeNom = (a, b) => simplifier(a).trim() === simplifier(b).trim();
    const trouverOuCreer = nom => {
      if (!nom) return "";
      let p = pieces.find(x => memeNom(x.nom, nom));
      if (!p) {
        const ancienne = etat.pieces.find(x => memeNom(x.nom, nom));
        p = { id: ancienne ? ancienne.id : nouvelId(), nom, couleur: "" };
        pieces.push(p);
      }
      return p.id;
    };
    [...lignesPieces].sort((a, b) => (+a["Ordre"] || 0) - (+b["Ordre"] || 0)).forEach(l => {
      const id = trouverOuCreer(l["Pièce"]);
      const p = pieces.find(x => x.id === id);
      if (p && COULEURS.includes(l["Couleur"])) p.couleur = l["Couleur"];
    });
    const taches = [];
    lignesTaches.forEach(l => {
      if (!l["Tâche"]) return;
      const fait = lireDate(l["Dernière fois"]);
      const histo = String(l["Historique"] || "").split(/[,;·]+/).map(lireDate).filter(Boolean);
      if (fait && !histo.includes(fait)) histo.push(fait);
      taches.push({
        id: (etat.taches.find(t => memeNom(t.nom, l["Tâche"])) || {}).id || nouvelId(),
        nom: l["Tâche"], piece: trouverOuCreer(l["Pièce"]),
        ...lireFreq(l["Tous les"] || l["Tous les (jours)"]),
        fait, report: lireDate(l["Repoussée au"]),
        histo: [...new Set(histo)].sort().reverse().slice(0, 30)
      });
    });
    // Pièces sans couleur dans le fichier : première couleur libre
    pieces.forEach(p => {
      if (!p.couleur) p.couleur = COULEURS.find(k => !pieces.some(x => x.couleur === k)) || "gris";
    });
    avecAnnulation(`Import terminé : ${taches.length} tâche(s)`, () => {
      etat.pieces = pieces;
      etat.taches = taches;
    });
  } catch (err) {
    afficherToast("Import impossible : " + err.message, null);
  }
});

// ---------- 8. Démarrage ----------

// Service worker : permet d'ouvrir l'appli sans réseau, de l'installer, et de se mettre à jour seule
if ("serviceWorker" in navigator && location.protocol === "https:") {
  // updateViaCache "none" : pour savoir s'il existe une nouvelle version, toujours
  // demander sw.js au serveur, jamais à la mémoire du téléphone
  navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then(reg => {
    // L'appli installée reste souvent ouverte en arrière-plan : à chaque retour dessus,
    // on vérifie s'il y a une mise à jour
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") reg.update().catch(() => {});
    });
  }).catch(() => {});
  // Quand la nouvelle version prend le relais, on recharge une fois pour l'afficher
  // (pas à la toute première installation ; et on attend qu'aucune fiche ne soit ouverte)
  const avaitUneVersion = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!avaitUneVersion || rechargementEnAttente) return;
    rechargementEnAttente = true;
    if (!fenetreOuverte()) location.reload();
  });
}

// En revenant sur l'appli le lendemain, les barres doivent avoir baissé : on redessine
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") router(); });

$("version").textContent = VERSION;
if (MODE_DEMO) demarrerDemo(); else demarrerFirebase();
