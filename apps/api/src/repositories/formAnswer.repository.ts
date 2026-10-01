import prisma from "@/lib/prisma.js";
import type { FormAnswer } from "@prisma/client";
import type { FilledField } from "@jobpilot/automation";

/**
 * FormAnswerRepository — stores every question→answer pair from Easy Apply.
 *
 * Why a dedicated table (not a JSON blob on Application):
 * - Queryable: "what did we answer for 'expected salary' across all jobs?"
 * - Reusable: AnswerResolver can pre-load past answers so repeat fields
 *   are never left blank on future applications
 * - Auditable: full history per application
 */
export class FormAnswerRepository {
  /**
   * Bulk-insert all filled fields for an application.
   * Called once after fillAllSteps() completes successfully.
   * Uses createMany — one round-trip for the whole step log.
   */
  async saveMany(
    applicationId: string,
    fields: FilledField[]
  ): Promise<number> {
    if (fields.length === 0) return 0;

    const result = await prisma.formAnswer.createMany({
      data: fields.map((f) => ({
        applicationId,
        questionText: f.label,
        questionKey: f.normalizedKey,
        answer: f.answer,
        inputType: f.type,
      })),
      skipDuplicates: false, // keep every run's answers even if question repeats
    });

    return result.count;
  }

  /**
   * Load all previous answers for a user across all applications,
   * keyed by questionKey. Used to pre-populate StoredAnswers for AnswerResolver.
   *
   * When the same question appears on multiple jobs, we use the most
   * recent answer (orderBy createdAt desc → first() wins per key).
   */
  async loadStoredAnswers(userId: string): Promise<Record<string, string>> {
    const rows = await prisma.formAnswer.findMany({
      where: {
        application: { userId },
      },
      orderBy: { createdAt: "desc" },
      select: { questionKey: true, answer: true },
    });

    // Build a map: questionKey → most recent answer
    const map: Record<string, string> = {};
    for (const row of rows) {
      if (row.questionKey && !(row.questionKey in map)) {
        map[row.questionKey] = row.answer;
      }
    }

    return map;
  }

  /**
   * Get all form answers for a specific application (for the audit log).
   */
  async findByApplicationId(applicationId: string): Promise<FormAnswer[]> {
    return prisma.formAnswer.findMany({
      where: { applicationId },
      orderBy: { createdAt: "asc" },
    });
  }
}

export const formAnswerRepository = new FormAnswerRepository();
