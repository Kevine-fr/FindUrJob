import mongoose from 'mongoose';

/**
 * L'entretien des candidatures : relancer en lot, et vérifier auprès des
 * plateformes.
 *
 * Les deux gestes existaient déjà, mais un par un et en bloquant : la
 * vérification ouvre un navigateur par plateforme, la relance un par
 * candidature. Sur trente candidatures c'est une dizaine de minutes — bien
 * au-delà de ce qu'une requête HTTP supporte, et pendant tout ce temps l'écran
 * restait figé sur un bouton occupé.
 *
 * Ce document porte donc l'état de ces deux travaux : ce qui tourne, où ça en
 * est, et ce que ça a donné la dernière fois. C'est ce que la page relit pour
 * suivre l'avancement, et ce qui empêche deux exécutions de se chevaucher.
 *
 * Le même document porte leur automatisation. Le modèle est celui déjà retenu
 * pour la collecte et la campagne — un drapeau, une expression cron — pour que
 * le planificateur n'ait pas trois façons différentes de lire la même chose.
 */
const travailSchema = {
  /** Automatisation : rien ne se déclenche seul tant qu'elle n'est pas demandée. */
  enabled: { type: Boolean, default: false },
  cron: { type: String, default: '0 8 * * *' },

  /*
   * En cours d'exécution.
   *
   * Sert de verrou : deux relances simultanées enverraient deux fois la même
   * candidature, ce qui est exactement l'erreur que tout le reste s'échine à
   * éviter. `startedAt` permet de rouvrir le verrou si le service est tombé au
   * milieu — sans quoi il resterait fermé pour toujours.
   */
  running: { type: Boolean, default: false },
  startedAt: { type: Date },

  /** Avancement, relu par la page pendant que ça tourne. */
  done: { type: Number, default: 0 },
  total: { type: Number, default: 0 },
  step: { type: String, default: '' },

  /** Ce que la dernière exécution a donné. */
  lastAt: { type: Date },
  lastResult: { type: String, default: '' },
};

const upkeepSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    /** Relance des candidatures qui n'ont pas abouti. */
    retry: travailSchema,
    /** Vérification de ce que les plateformes déclarent avoir reçu. */
    verify: travailSchema,

    /*
     * Combien de candidatures une relance en lot reprend au plus.
     *
     * Chacune ouvre un navigateur et rejoue un formulaire : sans plafond, une
     * relance nocturne pourrait tourner des heures et ressembler, vue de la
     * plateforme, à un acharnement.
     */
    retryMax: { type: Number, default: 10, min: 1, max: 100 },
  },
  { timestamps: true }
);

/** Le document du compte, créé à la première lecture. */
upkeepSchema.statics.forUser = async function forUser(user) {
  return (
    (await this.findOne({ user })) ||
    this.create({ user, retry: {}, verify: {} })
  );
};

export default mongoose.model('Upkeep', upkeepSchema);
