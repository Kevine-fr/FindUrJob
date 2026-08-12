import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import { useToast } from '../components/Toast.jsx';
import CvDropzone from '../components/CvDropzone.jsx';
import CvPreview from '../components/CvPreview.jsx';
import { Accordion, Field, TagsField, BulletList, Repeatable } from '../components/CvFields.jsx';
import { buildCvDocument } from '../lib/cvTemplate.js';

const ACCENTS = ['#2d5bff', '#0f766e', '#b4530a', '#7c3aed', '#be123c', '#15803d', '#1f2937'];

const EMPTY = {
  experience: { role: '', company: '', location: '', period: '', bullets: [] },
  education: { degree: '', school: '', location: '', period: '', detail: '' },
  project: { name: '', period: '', url: '', bullets: [] },
  certification: { name: '', issuer: '', date: '' },
  language: { name: '', level: '' },
  link: { type: 'linkedin', url: '', label: '' },
  skillGroup: { label: '', items: [] },
};

/** Une photo de CV ne dépasse pas 3 cm : inutile d'embarquer un fichier de 4 Mo. */
function shrinkPhoto(file, max = 480) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Image illisible.'));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error('Image illisible.'));
      image.onload = () => {
        const scale = Math.min(1, max / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.86));
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

const download = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

export default function CvBuilderPage() {
  const toast = useToast();
  const [profile, setProfile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [fit, setFit] = useState(null);
  const [view, setView] = useState('editor'); // seulement sur petit écran

  useEffect(() => {
    api.profile
      .get()
      .then(setProfile)
      .catch((error) => {
        toast.error(`Profil illisible : ${error.message}`);
        setProfile({});
      });
    // Au montage seulement : `toast` est stable, le profil ne doit pas se recharger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = useCallback((key) => (value) => setProfile((p) => ({ ...p, [key]: value })), []);

  const options = useMemo(
    () => ({
      accent: profile?.cvOptions?.accent || ACCENTS[0],
      showPhoto: profile?.cvOptions?.showPhoto !== false,
      autoTrim: profile?.cvOptions?.autoTrim !== false,
    }),
    [profile?.cvOptions]
  );

  const setOption = (key) => (value) =>
    setProfile((p) => ({ ...p, cvOptions: { ...(p.cvOptions || {}), [key]: value } }));

  if (!profile) {
    return (
      <div className="builder">
        <div>
          <div className="skeleton skeleton-line" style={{ width: '40%', height: 28 }} />
          <div className="skeleton skeleton-card" style={{ marginTop: 18 }} />
          <div className="skeleton skeleton-card" style={{ marginTop: 12 }} />
        </div>
        <div className="skeleton" style={{ aspectRatio: '210 / 297' }} />
      </div>
    );
  }

  const save = async () => {
    setBusy(true);
    try {
      await toast.promise(api.profile.update(profile).then(setProfile), {
        loading: 'Enregistrement…',
        success: 'Profil enregistré.',
        error: (error) => `Enregistrement impossible : ${error.message}`,
      });
    } catch {
      /* déjà signalé par le toast */
    } finally {
      setBusy(false);
    }
  };

  /** Reconstruit le CV texte : c'est lui que le moteur réécrit par offre. */
  const composeMaster = async () => {
    setBusy(true);
    try {
      await toast.promise(api.profile.composeCv(profile).then(setProfile), {
        loading: 'Composition du CV source…',
        success: (updated) =>
          `CV source régénéré (${(updated.cvChars || 0).toLocaleString('fr-FR')} caractères).`,
        error: (error) => `Composition impossible : ${error.message}`,
      });
    } catch {
      /* déjà signalé */
    } finally {
      setBusy(false);
    }
  };

  const exportPdf = async () => {
    setBusy(true);
    try {
      const html = buildCvDocument(profile, options);
      const { blob, fit: result } = await toast.promise(
        api.cv.pdf(html, profile.fullName || 'cv'),
        {
          loading: 'Impression du PDF…',
          success: 'PDF prêt.',
          error: (error) => `Impression impossible : ${error.message}`,
        }
      );

      download(blob, `${(profile.fullName || 'cv').replace(/\s+/g, '-')}.pdf`);
      setFit(result);

      if (result.overflow) {
        toast.error('Le CV dépasse la page : allège une expérience ou réduis le résumé.', {
          title: 'Deux pages',
        });
      } else if (result.trimmed > 0) {
        toast.info(
          `${result.trimmed} puce${result.trimmed > 1 ? 's' : ''} retirée${
            result.trimmed > 1 ? 's' : ''
          } pour tenir sur une page.`,
          { title: 'CV compacté' }
        );
      }
    } catch {
      /* déjà signalé */
    } finally {
      setBusy(false);
    }
  };

  const pickPhoto = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      set('photo')(await shrinkPhoto(file));
      toast.success('Photo ajoutée.');
    } catch (error) {
      toast.error(error.message);
    }
  };

  const fillPercent = Math.round((fit?.fill || 0) * 100);
  const fillClass = fit?.overflow ? 'is-over' : fillPercent > 96 ? 'is-tight' : '';

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Mon CV</h1>
          <p>
            Remplis les rubriques : l'aperçu est exactement le PDF qui sera produit. La mise en
            page se resserre toute seule pour tenir sur une page.
          </p>
        </div>
        <div className="inline">
          <button className={`btn${busy ? ' is-busy' : ''}`} onClick={save} disabled={busy}>
            Enregistrer
          </button>
          <button
            className={`btn btn-primary${busy ? ' is-busy' : ''}`}
            onClick={exportPdf}
            disabled={busy}
          >
            Télécharger le PDF
          </button>
        </div>
      </div>

      {/* Bascule éditeur / aperçu : sous 1100 px les deux ne tiennent pas côte à côte. */}
      <div className="inline view-switch" style={{ marginBottom: 14 }}>
        <button
          className={`filter-chip${view === 'editor' ? ' active' : ''}`}
          onClick={() => setView('editor')}
        >
          Éditeur
        </button>
        <button
          className={`filter-chip${view === 'preview' ? ' active' : ''}`}
          onClick={() => setView('preview')}
        >
          Aperçu
        </button>
      </div>

      <div className={`builder show-${view}`}>
        <div className="builder-editor">
          <Accordion title="Identité" defaultOpen>
            <div className="grid-2">
              <Field label="Nom complet" value={profile.fullName} onChange={set('fullName')} />
              <Field
                label="Titre"
                value={profile.headline}
                onChange={set('headline')}
                placeholder="Lead Développeur Fullstack"
              />
            </div>
            <div className="grid-2">
              <Field label="Email" type="email" value={profile.email} onChange={set('email')} />
              <Field label="Téléphone" value={profile.phone} onChange={set('phone')} />
            </div>
            <Field label="Localisation" value={profile.location} onChange={set('location')} />
            <Field
              label="En bref (2 à 3 phrases)"
              value={profile.summary}
              onChange={set('summary')}
              multiline
            />

            <div className="field">
              <label>Photo</label>
              <div className="inline">
                <input type="file" accept="image/*" onChange={pickPhoto} />
                {profile.photo && (
                  <button className="btn btn-danger btn-sm" onClick={() => set('photo')('')}>
                    Retirer
                  </button>
                )}
              </div>
            </div>
          </Accordion>

          <Accordion title="Compétences" count={(profile.skillGroups || []).length}>
            <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
              Groupe-les par famille (« Langages », « Cloud &amp; DevOps »…) : c'est ce qui rend la
              colonne lisible.
            </p>
            <Repeatable
              items={profile.skillGroups || []}
              empty={EMPTY.skillGroup}
              addLabel="Ajouter une famille"
              onChange={set('skillGroups')}
              titleOf={(item) => item.label}
              renderItem={(item, patch) => (
                <>
                  <Field
                    label="Famille"
                    value={item.label}
                    onChange={(value) => patch('label', value)}
                    placeholder="Frameworks backend"
                  />
                  <TagsField
                    label="Compétences"
                    hint="Séparées par des virgules — les espaces sont autorisés."
                    value={item.items || []}
                    onChange={(items) => patch('items', items)}
                    placeholder="Spring Boot, NestJS, React Native"
                  />
                </>
              )}
            />
          </Accordion>

          <Accordion title="Expériences" count={(profile.experiences || []).length}>
            <Repeatable
              items={profile.experiences || []}
              empty={EMPTY.experience}
              addLabel="Ajouter une expérience"
              onChange={set('experiences')}
              titleOf={(item) => item.role || item.company}
              renderItem={(item, patch) => (
                <>
                  <div className="grid-2">
                    <Field label="Poste" value={item.role} onChange={(v) => patch('role', v)} />
                    <Field
                      label="Entreprise"
                      value={item.company}
                      onChange={(v) => patch('company', v)}
                    />
                  </div>
                  <div className="grid-2">
                    <Field
                      label="Lieu"
                      value={item.location}
                      onChange={(v) => patch('location', v)}
                    />
                    <Field
                      label="Période"
                      value={item.period}
                      onChange={(v) => patch('period', v)}
                      placeholder="10/2024 - aujourd'hui"
                    />
                  </div>
                  <BulletList bullets={item.bullets || []} onChange={(v) => patch('bullets', v)} />
                </>
              )}
            />
          </Accordion>

          <Accordion title="Projets" count={(profile.projects || []).length}>
            <Repeatable
              items={profile.projects || []}
              empty={EMPTY.project}
              addLabel="Ajouter un projet"
              onChange={set('projects')}
              titleOf={(item) => item.name}
              renderItem={(item, patch) => (
                <>
                  <div className="grid-2">
                    <Field label="Nom" value={item.name} onChange={(v) => patch('name', v)} />
                    <Field label="Période" value={item.period} onChange={(v) => patch('period', v)} />
                  </div>
                  <BulletList bullets={item.bullets || []} onChange={(v) => patch('bullets', v)} />
                </>
              )}
            />
          </Accordion>

          <Accordion title="Formation" count={(profile.education || []).length}>
            <Repeatable
              items={profile.education || []}
              empty={EMPTY.education}
              addLabel="Ajouter une formation"
              onChange={set('education')}
              titleOf={(item) => item.degree}
              renderItem={(item, patch) => (
                <>
                  <div className="grid-2">
                    <Field label="Diplôme" value={item.degree} onChange={(v) => patch('degree', v)} />
                    <Field label="École" value={item.school} onChange={(v) => patch('school', v)} />
                  </div>
                  <div className="grid-2">
                    <Field label="Lieu" value={item.location} onChange={(v) => patch('location', v)} />
                    <Field label="Période" value={item.period} onChange={(v) => patch('period', v)} />
                  </div>
                  <Field
                    label="Précision (facultatif)"
                    value={item.detail}
                    onChange={(v) => patch('detail', v)}
                    placeholder="Titre RNCP niveau 7"
                  />
                </>
              )}
            />
          </Accordion>

          <Accordion title="Certifications" count={(profile.certifications || []).length}>
            <Repeatable
              items={profile.certifications || []}
              empty={EMPTY.certification}
              addLabel="Ajouter une certification"
              onChange={set('certifications')}
              titleOf={(item) => item.name}
              renderItem={(item, patch) => (
                <>
                  <Field label="Intitulé" value={item.name} onChange={(v) => patch('name', v)} />
                  <div className="grid-2">
                    <Field
                      label="Organisme"
                      value={item.issuer}
                      onChange={(v) => patch('issuer', v)}
                    />
                    <Field label="Date" value={item.date} onChange={(v) => patch('date', v)} />
                  </div>
                </>
              )}
            />
          </Accordion>

          <Accordion title="Langues" count={(profile.languages || []).length}>
            <Repeatable
              items={profile.languages || []}
              empty={EMPTY.language}
              addLabel="Ajouter une langue"
              onChange={set('languages')}
              titleOf={(item) => item.name}
              renderItem={(item, patch) => (
                <div className="grid-2">
                  <Field label="Langue" value={item.name} onChange={(v) => patch('name', v)} />
                  <Field
                    label="Niveau"
                    value={item.level}
                    onChange={(v) => patch('level', v)}
                    placeholder="Courant, B2, langue maternelle…"
                  />
                </div>
              )}
            />
          </Accordion>

          <Accordion title="Liens" count={(profile.links || []).length}>
            <Repeatable
              items={profile.links || []}
              empty={EMPTY.link}
              addLabel="Ajouter un lien"
              onChange={set('links')}
              titleOf={(item) => item.label || item.type}
              renderItem={(item, patch) => (
                <>
                  <div className="field">
                    <label>Type</label>
                    <select
                      className="select"
                      value={item.type || 'autre'}
                      onChange={(event) => patch('type', event.target.value)}
                    >
                      <option value="linkedin">LinkedIn</option>
                      <option value="github">GitHub</option>
                      <option value="portfolio">Portfolio</option>
                      <option value="autre">Autre</option>
                    </select>
                  </div>
                  <Field
                    label="URL"
                    value={item.url}
                    onChange={(v) => patch('url', v)}
                    placeholder="https://linkedin.com/in/…"
                  />
                  <Field
                    label="Libellé affiché (facultatif)"
                    value={item.label}
                    onChange={(v) => patch('label', v)}
                  />
                </>
              )}
            />
          </Accordion>

          <Accordion title="Importer un CV existant">
            <CvDropzone profile={profile} onChange={setProfile} />
          </Accordion>

          <Accordion title="CV source (texte réécrit par offre)">
            <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
              C'est ce texte que le moteur reprend pour chaque offre. « Régénérer » le reconstruit
              depuis les rubriques ci-dessus.
            </p>
            <button
              className={`btn btn-sm${busy ? ' is-busy' : ''}`}
              onClick={composeMaster}
              disabled={busy}
            >
              Régénérer depuis les rubriques
            </button>
            <textarea
              className="textarea"
              style={{ minHeight: 220, marginTop: 12 }}
              value={profile.masterCv || ''}
              onChange={(event) => set('masterCv')(event.target.value)}
            />
          </Accordion>
        </div>

        <div className="builder-preview">
          <div className="sheet-wrap">
            <div className="sheet-bar">
              <div className="swatches">
                {ACCENTS.map((color) => (
                  <button
                    key={color}
                    className={`swatch${options.accent === color ? ' active' : ''}`}
                    style={{ background: color }}
                    onClick={() => setOption('accent')(color)}
                    aria-label={`Couleur ${color}`}
                  />
                ))}
              </div>

              <div className="fill-gauge">
                <span>{fit ? `${fillPercent} %` : '—'}</span>
                <span className="fill-track">
                  <span
                    className={`fill-bar ${fillClass}`}
                    style={{ width: `${Math.min(100, fillPercent)}%` }}
                  />
                </span>
              </div>
            </div>

            <CvPreview profile={profile} options={options} onFit={setFit} />

            <div className="inline" style={{ marginTop: 12, justifyContent: 'space-between' }}>
              <label className="inline" style={{ fontSize: 13, gap: 7 }}>
                <input
                  type="checkbox"
                  checked={options.autoTrim}
                  onChange={(event) => setOption('autoTrim')(event.target.checked)}
                />
                Compacter pour tenir sur une page
              </label>
              <span className="muted" style={{ fontSize: 12.5 }}>
                {fit?.trimmed > 0
                  ? `${fit.trimmed} puce(s) masquée(s)`
                  : fit
                    ? `densité ${fit.density}`
                    : ''}
              </span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
