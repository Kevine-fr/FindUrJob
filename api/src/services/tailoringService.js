/**
 * Point d'intégration du moteur IA (Python).
 *
 * Tant que PYTHON_AI_URL n'est pas défini, on renvoie une version "stub"
 * déterministe pour que l'ossature tourne de bout en bout, sans IA.
 *
 * Contrat attendu du service Python — POST {PYTHON_AI_URL}/tailor :
 *   entrée : { offer, profile }
 *   sortie : { content, coverLetter, score, keywords }
 *
 * C'est ici, et nulle part ailleurs, qu'on branchera le moteur.
 */
/**
 * Assemble un CV Markdown à partir des champs du formulaire.
 * POST {PYTHON_AI_URL}/compose-cv — entrée : { profile }, sortie : { content, chars }
 */
export async function composeCv(profile) {
  const aiUrl = process.env.PYTHON_AI_URL;
  if (aiUrl) {
    const res = await fetch(`${aiUrl}/compose-cv`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.detail || `Moteur IA : ${res.status}`);
      err.status = 502;
      throw err;
    }
    return data;
  }

  // Repli local : même structure, sans le moteur.
  const parts = [`# ${profile.fullName || 'Mon CV'}`];
  if (profile.headline) parts.push(`_${profile.headline}_`);
  if (profile.summary) parts.push(`\n## En bref\n\n${profile.summary}`);
  if (profile.skills?.length) parts.push(`\n## Compétences\n\n${profile.skills.join(', ')}`);
  const content = parts.join('\n') + '\n';
  return { content, chars: content.length };
}

/**
 * Recherche d'offres sur les sources configurées du moteur.
 *
 * POST {PYTHON_AI_URL}/search
 *   entrée : { keywords, location, contractTypes, remotes, sources, limit }
 *   sortie : { offers[], total, sources{} }
 */
export async function searchOffers(criteria) {
  const aiUrl = process.env.PYTHON_AI_URL;
  if (!aiUrl) {
    const err = new Error(
      "Moteur IA indisponible : impossible d'aller chercher des offres. " +
        'Démarre le service `ai` (docker compose up ai).'
    );
    err.status = 503;
    throw err;
  }

  const res = await fetch(`${aiUrl}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(criteria),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.detail || `Moteur IA : ${res.status} ${res.statusText}`);
    err.status = 502;
    throw err;
  }
  return data;
}

/**
 * Extraction du texte d'un CV déposé (PDF, DOCX, TXT, MD).
 *
 * Le moteur Python fait le travail : POST {PYTHON_AI_URL}/extract-cv (multipart).
 * Sans moteur, seuls les formats texte sont lisibles ici — on le dit clairement
 * plutôt que de renvoyer un CV vide.
 */
export async function extractCv({ filename, buffer }) {
  const aiUrl = process.env.PYTHON_AI_URL;

  if (aiUrl) {
    const form = new FormData();
    form.append('file', new Blob([buffer]), filename);

    const res = await fetch(`${aiUrl}/extract-cv`, { method: 'POST', body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.detail || `Moteur IA : ${res.status} ${res.statusText}`);
      err.status = res.status === 413 || res.status === 415 ? res.status : 502;
      throw err;
    }
    return data;
  }

  if (!/\.(txt|md|markdown)$/i.test(filename)) {
    const err = new Error(
      "Moteur IA indisponible : seuls les fichiers .txt et .md peuvent être lus sans lui. " +
        'Démarre le service `ai` pour déposer un PDF ou un DOCX.'
    );
    err.status = 503;
    throw err;
  }

  const text = buffer.toString('utf8').trim();
  return { text, chars: text.length, pages: 0, filename, warnings: [] };
}

/**
 * Score une offre sans rien générer.
 *
 * Le score est déterministe côté moteur : quelques millisecondes, aucun appel
 * au modèle, aucun coût. La campagne s’en sert pour écarter les offres sous le
 * seuil **avant** de payer une génération qu’elle jetterait ensuite.
 *
 * Sans moteur configuré, on renvoie `null` : l’appelant traite alors l’offre
 * comme non filtrable plutôt que de la rejeter sur un score inventé.
 */
export async function scoreOffer({ offer, profile }) {
  const aiUrl = process.env.PYTHON_AI_URL;
  if (!aiUrl) return null;

  const res = await fetch(`${aiUrl}/score`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ offer, profile }),
  });
  if (!res.ok) return null;

  const data = await res.json();
  return typeof data.score === 'number' ? data.score : null;
}

export async function tailorCv({ offer, profile }) {
  const aiUrl = process.env.PYTHON_AI_URL;

  if (aiUrl) {
    const res = await fetch(`${aiUrl}/tailor`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ offer, profile }),
    });
    if (!res.ok) throw new Error(`Moteur IA : ${res.status} ${res.statusText}`);
    return res.json();
  }

  // --- Stub (à remplacer par le moteur Python) ---
  const name = profile?.fullName || 'Candidat';
  const role = offer?.title || 'le poste visé';
  const at = offer?.company ? ` @ ${offer.company}` : '';
  const base = profile?.masterCv || '> Renseigne ton CV maître dans le Profil.';

  return {
    content: `# ${name}\n\n_CV ciblé (brouillon sans IA) — ${role}${at}._\n\n${base}\n`,
    coverLetter:
      `Objet : Candidature — ${role}\n\n` +
      'Madame, Monsieur,\n\n' +
      "(Lettre à générer par le moteur IA en fonction de l'offre.)\n\n" +
      `Cordialement,\n${name}`,
    score: null,
    keywords: [],
  };
}
