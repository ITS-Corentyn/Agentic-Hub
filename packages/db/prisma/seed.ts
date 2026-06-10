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

  // Repo de démonstration (public) pour valider le flux bout-en-bout.
  await prisma.repository.upsert({
    where: { fullName: 'OWASP/NodeGoat' },
    update: {},
    create: {
      fullName: 'OWASP/NodeGoat',
      name: 'NodeGoat',
      owner: 'OWASP',
      url: 'https://github.com/OWASP/NodeGoat',
      defaultBranch: 'master',
      language: 'JavaScript',
      description: 'Application volontairement vulnérable — idéale pour tester les scanners.',
    },
  });

  console.log('✔ Seed terminé');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
