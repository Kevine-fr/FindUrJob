# Conventions de travail

## Git

- **Développer sur `dev`.** Jamais de commit direct sur `main`.
- **Toujours ouvrir une pull request en fin de tâche**, sans attendre qu'on la
  demande. C'est Kévine qui fusionne, jamais l'assistant.
- La CD (`.github/workflows/deploy.yml`) ne se déclenche **que** sur un push
  vers `main` : tant que la PR n'est pas fusionnée, rien n'est déployé. Un
  correctif que l'utilisateur ne voit pas encore en production est normal — le
  dire plutôt que de chercher un second bug.
- `dev` peut avoir été fusionnée pendant qu'on travaillait : vérifier l'état de
  `main` avant d'ouvrir une PR. Une PR fusionnée est close, elle ne se réutilise
  pas.

## Avant de proposer un correctif

- **Regarder ce que `main` contient déjà.** Le dépôt avance en parallèle, et du
  travail a déjà été dupliqué deux fois : une capture d'écran d'échec, puis une
  correction France Travail dont l'hypothèse était fausse. Une correction
  reproduite dans un vrai navigateur l'emporte toujours sur une correction
  éprouvée sur page reconstituée.
- Aucune base MongoDB ni plateforme réelle n'est joignable depuis cet
  environnement. D'où la manière de tester : extraire des **fonctions pures** et
  les éprouver, ou rendre de vraies pages dans le Chromium local
  (`/opt/pw-browsers/chromium-*/chrome-linux/chrome`). Le dire quand une
  vérification n'est pas possible, plutôt que d'affirmer.

## Style

- Code et commentaires en **français**. Les commentaires expliquent le *pourquoi*
  — souvent le bug passé qui justifie la ligne — pas le *quoi*.
- Messages de commit et PR en anglais pour le titre, corps en français.
- Ne jamais construire de contournement de captcha : on le détecte, on le nomme,
  et on rend la main à la personne.
