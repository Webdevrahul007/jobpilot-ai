/**
 * Prisma seed script — populates the database with a default dev user.
 * Run with: npm run db:seed
 *
 * Safe to re-run: uses upsert so it won't duplicate records.
 */

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding database...");

  const hashedPassword = await bcrypt.hash("Password@123", 12);

  const user = await prisma.user.upsert({
    where: { email: "rahul@jobpilot.dev" },
    update: {},
    create: {
      email: "rahul@jobpilot.dev",
      password: hashedPassword,
      name: "Rahul Jangid",
      profile: {
        create: {
          firstName: "Rahul",
          lastName: "Jangid",
          phone: "+91-9999999999",
          city: "Bangalore",
          country: "India",
          totalYearsExp: 3,
          currentJobTitle: "Software Engineer",
          noticePeriodDays: 30,
          expectedSalary: 100000,
          currency: "INR",
          visaRequired: false,
          resumeFileName: "Rahul_Jangid_Resume.pdf",
        },
      },
    },
    include: { profile: true },
  });

  console.log(`✅ User created: ${user.email}`);
  console.log(`   Name: ${user.name}`);
  console.log(`   Profile ID: ${user.profile?.id}`);
  console.log("\n🔑 Dev credentials:");
  console.log("   Email:    rahul@jobpilot.dev");
  console.log("   Password: Password@123");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
