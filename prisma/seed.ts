import { ensureDemoProject, ensureTemplate } from "../src/server/project-repository";
import { prisma } from "../src/server/db";

async function main() {
  await ensureTemplate();
  const project = await ensureDemoProject();
  console.log(`Seeded: ${project.name}`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
