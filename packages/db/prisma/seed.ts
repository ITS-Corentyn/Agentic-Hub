import { PrismaClient } from '../generated/client/index.js';

const prisma = new PrismaClient();

async function main() {
  // Paramètres de scoring par défaut (singleton id=1).
  await prisma.setting.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      scoring: {
        weights: {
          security: 30,
          dependencies: 15,
          quality: 15,
          architecture: 15,
          backend: 10,
          frontend: 8,
          performance: 7,
        },
        locBaseline: 2000,
      },
    },
  });

  // Aucun repository de démonstration n'est inséré : seuls les repos du compte
  // GitHub connecté (via « Synchroniser GitHub ») apparaissent.
  console.log('✔ Seed terminé (paramètres uniquement, aucune donnée de test)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
