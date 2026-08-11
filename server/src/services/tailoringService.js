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
