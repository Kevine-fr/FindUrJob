import nodemailer from 'nodemailer';

/**
 * Envoi de courriels transactionnels (vérification d'adresse, mot de passe
 * oublié).
 *
 * Le transport n'est construit qu'une fois, et seulement si `SMTP_HOST` est
 * renseigné. Sans configuration, `sendMail` ne lève pas : il journalise le lien
 * et rend `{ sent: false }`. C'est délibéré — en développement on veut pouvoir
 * suivre le parcours complet sans serveur SMTP, et en production un envoi qui
 * échoue ne doit pas faire échouer l'inscription elle-même.
 *
 * L'appelant décide quoi dire à l'utilisateur à partir de `sent`.
 */

let transport;
let transportPret = false;

function getTransport() {
  if (transportPret) return transport;
  transportPret = true;

  const host = process.env.SMTP_HOST;
  if (!host) {
    transport = null;
    return null;
  }

  transport = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT) || 587,
    // 465 impose TLS d'emblée ; les autres ports montent en TLS via STARTTLS.
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
      : undefined,
  });
  return transport;
}

/** L'adresse publique de l'application, pour fabriquer les liens des courriels. */
export function appUrl() {
  return (process.env.APP_URL || 'http://localhost:5173').replace(/\/+$/, '');
}

export function mailerConfigured() {
  return Boolean(process.env.SMTP_HOST);
}

export async function sendMail({ to, subject, text, html }) {
  const t = getTransport();

  if (!t) {
    // Sans SMTP, le lien reste visible dans les journaux du serveur : c'est le
    // seul moyen de terminer le parcours en développement.
    console.log(`[mail non envoyé — SMTP non configuré] à ${to} : ${subject}\n${text}`);
    return { sent: false };
  }

  try {
    await t.sendMail({
      from: process.env.SMTP_FROM || 'FindUrJob <no-reply@findurjob.local>',
      to,
      subject,
      text,
      html: html || undefined,
    });
    return { sent: true };
  } catch (error) {
    // Un envoi raté ne doit jamais annuler l'action métier (inscription,
    // demande de réinitialisation) : on le signale et on continue.
    console.error('envoi de courriel impossible :', error.message);
    return { sent: false, error: error.message };
  }
}

/** Le courriel de vérification d'adresse. */
export function verifyMail(user, secret) {
  const lien = `${appUrl()}/verifier-email?token=${secret}`;
  return {
    to: user.email,
    subject: 'Confirme ton adresse — FindUrJob',
    text:
      `Bonjour ${user.fullName || ''},\n\n` +
      `Confirme ton adresse en ouvrant ce lien :\n${lien}\n\n` +
      `Le lien expire dans 24 heures. Si tu n'es pas à l'origine de cette ` +
      `inscription, ignore ce message.\n`,
  };
}

/** Le courriel de réinitialisation du mot de passe. */
export function resetMail(user, secret) {
  const lien = `${appUrl()}/mot-de-passe?token=${secret}`;
  return {
    to: user.email,
    subject: 'Réinitialiser ton mot de passe — FindUrJob',
    text:
      `Bonjour ${user.fullName || ''},\n\n` +
      `Choisis un nouveau mot de passe ici :\n${lien}\n\n` +
      `Le lien expire dans 1 heure. Si tu n'as rien demandé, ignore ce ` +
      `message : ton mot de passe actuel reste valable.\n`,
  };
}
