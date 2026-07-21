import { db } from "@/server/prisma-minimal";

export const devUser = {
  email: process.env.DCH_DEV_USER_EMAIL ?? "dev@dch.local",
  name: process.env.DCH_DEV_USER_NAME ?? "Lokal DcH-bruger"
};

export async function getCurrentUserId(): Promise<string> {
  const user = await db.user.upsert({
    where: { email: devUser.email },
    update: { name: devUser.name },
    create: devUser
  });

  return user.id;
}
