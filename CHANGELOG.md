# Journal des nouveautés — Clean to go

## v1.0.0 — 2026-11-07
Première version définitive.
- Conversion automatique des fréquences « rondes » : 30, 60, 90 j → 1, 2, 3 mois ; 7, 14, 21 j → 1, 2, 3 sem. ; 15 j → 2 sem.
- Excel : la colonne « Tous les (jours) » reste toujours en jours (1 sem. = 7 j, 1 mois = 30 j).

## v0.2.0 — 2026-11-07
Côté jeu et affichage.
- Fréquence au choix : tous les X jours, semaines ou mois (en mois, même jour du mois). Excel : colonne « Tous les » (« 2 sem. », « 1 mois »…) ; les anciens fichiers en jours se réimportent toujours.
- Mini-barres par pièce (sur 2 colonnes) sous la jauge maison.
- Tâches propres (barre ≥ 70 %) rangées sous une ligne « › N tâches propres » qu'on déplie ; dépliées, elles sont grisées.
- Réglages → Vue Pièces : Liste ou 2 colonnes (sur chaque appareil).
- Effets façon jeu (Animations : Complètes) : confettis, petite secousse, « +X % » qui s'envole vers la jauge, jauge qui compte point par point avec un bip de plus en plus aigu, chiffre qui tangue, mini-barre qui saute, grosse bannière « PIÈCE 100 % » avec jingle et vibration. « +2 j » qui s'envole quand on repousse.
- Sons 8-bit plus riches, crans de vibration pendant le glisser. Son activé par défaut sur un nouvel appareil.

## v0.1.1 — 2026-11-07
- Correctif : plus de barre de remplissage automatique (clé / carte / adresse) au-dessus du clavier dans les cases de saisie.
- Sur téléphone, les listes déroulantes s'ouvrent dans un petit panneau en bas (coche sur le choix actuel, case « Chercher… » au-delà de 10 choix). Sur PC, rien ne change.

## v0.1.0 — 2026-11-07
Première version.
- Tâches de ménage qui reviennent « tous les X jours », le compteur repartant du jour où on l'a faite.
- Barre de vie sur chaque tâche : se vide jusqu'à l'échéance (vert → jaune → corail), « +2 j » en rouge quand c'est en retard.
- Jauge « maison propre à X % » en haut (moyenne des barres), et un % par pièce.
- Deux vues : « À faire » (tout, le plus urgent en haut, carré de couleur de la pièce) et « Pièces » (un cadre par pièce).
- Glisser une tâche à droite = Fait (avec « Annuler ») ; à gauche = Plus tard (+1 j, +2 j, +3 j, +1 sem.).
- Toucher une tâche : mini-fiche avec Fait / Plus tard, historique des dates, et Modifier / Supprimer dans le menu « ⋯ ».
- Pause (vacances) : les compteurs sont gelés ; à la reprise, toutes les échéances avancent d'autant.
- Mode Modifier (crayon) : ajouter une tâche (nom, pièce, fréquence, dernière fois), croix pour supprimer.
- Recherche par nom de tâche ou de pièce.
- Réglages : Mes pièces (nom, couleur, ordre par glisser-déposer), Thème (Auto / Clair / Sombre), Animations, Vibration, Son, Export / Import Excel, synchro, version.
- Synchro tel + PC (Firebase), marche hors ligne, mise à jour automatique.
