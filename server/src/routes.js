import { readFileSync } from 'node:fs';
import { Router } from 'express';
import * as auth from './controllers/authController.js';
import * as admin from './controllers/adminController.js';
import { requireAuth, requireAdmin } from './middleware.js';
import * as offers from './controllers/offerController.js';
import * as applications from './controllers/applicationController.js';
import * as cv from './controllers/cvController.js';
import * as profile from './controllers/profileController.js';
import * as preferences from './controllers/preferenceController.js';
import * as history from './controllers/historyController.js';
import * as accounts from './controllers/accountController.js';
import * as cvExport from './controllers/cvExportController.js';
import * as campaign from './controllers/campaignController.js';
import * as alerts from './controllers/alertController.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const router = Router();

/*
 * Santé et version.
 *
 * `APP_VERSION` est écrite par la CI dans le `.env` : c’est la version du
 * déploiement, celle qui bouge à chaque livraison. Le `package.json` ne sert
 * plus que de repli en développement, où aucune CI n’est passée.
 *
 * `APP_COMMIT` complète : savoir « 0.1.0 » ne suffit pas à identifier ce qui
 * tourne réellement quand on déploie plusieurs fois par jour.
 */
router.get('/health', (req, res) => {
  /*
   * `deployed` distingue une version livrée d'un repli.
   *
   * Sans lui, `0.1.0` — la valeur figée du `package.json` — se lisait comme une
   * version publiée. C'est ce qui a permis à la chaîne de rester cassée sans
   * qu'on le voie : le compose de production ne transmettait pas `APP_VERSION`,
   * l'écran affichait tranquillement `0.1.0` à chaque livraison, et rien ne
   * disait que ce numéro ne voulait plus rien dire.
   */
  const livree = Boolean(process.env.APP_VERSION);

  res.json({
    status: 'ok',
    service: 'findurjob-api',
    version: process.env.APP_VERSION || pkg.version,
    deployed: livree,
    commit: (process.env.APP_COMMIT || '').slice(0, 7),
    builtAt: process.env.APP_BUILT_AT || '',
    time: new Date().toISOString(),
  });
});

// --- Authentification (seules routes ouvertes) --------------------------
router.post('/auth/register', auth.register);
router.post('/auth/login', auth.login);
router.post('/auth/logout', auth.logout);
router.get('/auth/me', auth.me);
router.patch('/auth/me', requireAuth, auth.updateMe);
router.delete('/auth/me', requireAuth, auth.deleteMe);
router.post('/auth/verify/send', requireAuth, auth.sendVerification);
router.post('/auth/verify', auth.verifyEmail);
router.post('/auth/password/forgot', auth.forgotPassword);
router.post('/auth/password/reset', auth.resetPassword);
router.post('/auth/password/change', requireAuth, auth.changePassword);

/*
 * Tout ce qui suit appartient à quelqu'un.
 *
 * La garde est posée ici, une fois, plutôt que route par route : un oubli sur
 * une seule ligne exposerait les données d'un compte à un autre.
 */
router.use(requireAuth);

// Offres
router.get('/offers', offers.listOffers);
router.post('/offers', offers.createOffer);
router.get('/offers/map', offers.mapOffers);
router.post('/offers/sync', offers.syncOffers); // avant /:id, sinon capté comme un id
router.get('/offers/:id', offers.getOffer);
router.patch('/offers/:id', offers.updateOffer);
router.delete('/offers/:id', offers.deleteOffer);

// Candidatures
router.get('/applications', applications.listApplications);
router.post('/applications', applications.createApplication);
router.get('/applications/:id', applications.getApplication);
router.patch('/applications/:id', applications.updateApplication);
router.patch('/applications/:id/status', applications.updateStatus);
router.post('/applications/:id/tailor', applications.tailorApplication);
router.delete('/applications/:id', applications.deleteApplication);

// Export PDF du CV : le front envoie le document, Chromium l'imprime.
router.post('/cv/pdf', cvExport.exportCvPdf);

// Administration : lecture de tout le flux et gestion des comptes.
router.get('/admin/overview', requireAdmin, admin.overview);
router.get('/admin/users', requireAdmin, admin.listUsers);
router.patch('/admin/users/:id', requireAdmin, admin.updateUser);
router.delete('/admin/users/:id', requireAdmin, admin.deleteUser);

// Campagne automatique : rythme, garde-fous, exécution immédiate
router.get('/campaign', campaign.getCampaign);
router.put('/campaign', campaign.updateCampaign);
router.post('/campaign/run', campaign.runNow);

// Comptes de plateformes : identifiants chiffrés + sessions du navigateur piloté
router.get('/accounts', accounts.listAccounts);
router.post('/accounts/:platform/manual', accounts.openManualLogin);
router.get('/accounts/:platform/manual', accounts.checkManualLogin);
router.put('/accounts/:platform', accounts.saveAccount);
router.delete('/accounts/:platform', accounts.deleteAccount);
router.post('/accounts/:platform/login', accounts.loginAccount);
router.post('/accounts/:platform/logout', accounts.logoutAccount);

// Versions de CV
router.get('/cv-versions', cv.listCvVersions);
router.post('/cv-versions', cv.createCvVersion);
router.get('/cv-versions/:id', cv.getCvVersion);
router.get('/profile/cv-file', profile.getCvFile);
router.get('/cv-versions/:id/pdf', cv.getCvVersionPdf);
router.get('/applications/:id/letter.pdf', applications.getLetterPdf);
router.delete('/cv-versions/:id', cv.deleteCvVersion);

// Profil (singleton) + CV déposé
router.get('/profile', profile.getProfile);
router.put('/profile', profile.updateProfile);
router.post('/profile/cv', profile.uploadCv);
router.delete('/profile/cv', profile.deleteCv);
router.post('/profile/compose', profile.composeProfileCv);

// Préférences de recherche (singleton)
router.get('/preferences', preferences.getPreferences);
router.put('/preferences', preferences.updatePreferences);

// Historique : statuts journalisés + CV générés, en un seul flux
router.get('/history', history.listHistory);

/*
 * Alertes et notifications.
 *
 * `preview` regarde sans rien envoyer ni entamer de quota ; `run` déclenche
 * réellement. Les deux existent parce qu'on ne règle pas une alerte à l'aveugle,
 * et qu'un essai qui enverrait des courriels ne serait pas un essai.
 */
router.get('/alerts', alerts.listAlerts);
router.post('/alerts', alerts.createAlert);
router.patch('/alerts/:id', alerts.updateAlert);
router.delete('/alerts/:id', alerts.deleteAlert);
router.post('/alerts/:id/preview', alerts.previewAlert);
router.post('/alerts/:id/run', alerts.runAlertNow);

// Abonnements aux notifications du navigateur : un par appareil.
router.get('/push/key', alerts.pushKey);
router.post('/push/subscribe', alerts.subscribePush);
router.post('/push/unsubscribe', alerts.unsubscribePush);
router.post('/push/test', alerts.testPush);

export default router;
