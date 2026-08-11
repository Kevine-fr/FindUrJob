import { Router } from 'express';
import * as offers from './controllers/offerController.js';
import * as applications from './controllers/applicationController.js';
import * as cv from './controllers/cvController.js';
import * as profile from './controllers/profileController.js';
import * as preferences from './controllers/preferenceController.js';
import * as history from './controllers/historyController.js';

const router = Router();

router.get('/health', (req, res) =>
  res.json({ status: 'ok', service: 'findurjob-api', time: new Date().toISOString() })
);

// Offres
router.get('/offers', offers.listOffers);
router.post('/offers', offers.createOffer);
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

// Versions de CV
router.get('/cv-versions', cv.listCvVersions);
router.post('/cv-versions', cv.createCvVersion);
router.get('/cv-versions/:id', cv.getCvVersion);
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

export default router;
