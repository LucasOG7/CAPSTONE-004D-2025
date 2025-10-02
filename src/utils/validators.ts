// src/utils/validators.ts
import { z } from "zod";

/**
 * ─────────────────────────────────────────────────────────────
 * AUTH
 * ─────────────────────────────────────────────────────────────
 */

export const registerSchema = z.object({
  name: z.string().min(2, "El nombre es demasiado corto"),
  email: z.string().email("Correo inválido"),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres"),
  // opcional si ya creas el usuario directo en supabase auth
  fecnac: z.string().optional(), // 'YYYY-MM-DD'
});

export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().email("Correo inválido"),
  password: z.string().min(8, "Contraseña inválida"),
});

export type LoginInput = z.infer<typeof loginSchema>;

/**
 * ─────────────────────────────────────────────────────────────
 * PROFILE (user_profile)
 * ─────────────────────────────────────────────────────────────
 */

export const profileUpdateSchema = z.object({
  name: z.string().min(2).optional(),
  fecnac: z.string().optional(), // 'YYYY-MM-DD'
  age_range: z.string().optional(),
  experience: z.enum(["beginner", "intermediate", "advanced"]).optional(),
  monthly_income: z.number().nonnegative("Debe ser >= 0").optional(),
  finance_goal: z.string().optional(),
  current_situation: z.string().optional(),
});

export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;

/**
 * ─────────────────────────────────────────────────────────────
 * GOALS (financial_goal)
 * ─────────────────────────────────────────────────────────────
 */

export const goalCreateSchema = z.object({
  title: z.string().min(2, "Título muy corto"),
  description: z.string().optional(),
  target_amount: z.number().positive("Debe ser > 0"),
  deadline: z.string().optional(), // 'YYYY-MM-DD'
});

export type GoalCreateInput = z.infer<typeof goalCreateSchema>;

export const goalUpdateSchema = goalCreateSchema.partial().extend({
  current_amount: z.number().min(0, "No puede ser negativo").optional(),
});

export type GoalUpdateInput = z.infer<typeof goalUpdateSchema>;

/**
 * ─────────────────────────────────────────────────────────────
 * GOAL CONTRIBUTIONS (goal_contribution)
 * ─────────────────────────────────────────────────────────────
 */

export const contributionCreateSchema = z.object({
  amount: z.number().positive("Debe ser > 0"),
  note: z.string().optional(),
});

export type ContributionCreateInput = z.infer<typeof contributionCreateSchema>;

/**
 * ─────────────────────────────────────────────────────────────
 * TRANSACTIONS (transaction)
 * ─────────────────────────────────────────────────────────────
 */

export const transactionCreateSchema = z.object({
  amount: z.number(), // puede ser negativo si prefieres separar por type
  type: z.enum(["income", "expense"]),
  category_id: z.number().optional(), // si tienes categories
  description: z.string().optional(),
  occurred_at: z.string().optional(), // 'YYYY-MM-DD'
});

export type TransactionCreateInput = z.infer<typeof transactionCreateSchema>;

export const transactionUpdateSchema = transactionCreateSchema.partial();

export type TransactionUpdateInput = z.infer<typeof transactionUpdateSchema>;

// filtros de listados: /transactions?from=YYYY-MM-DD&to=YYYY-MM-DD&type=income|expense
export const transactionQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  type: z.enum(["income", "expense"]).optional(),
});

export type TransactionQuery = z.infer<typeof transactionQuerySchema>;

// resumen mensual: /transactions/summary/month?month=YYYY-MM
export const monthSummaryQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, "Formato esperado: YYYY-MM"),
});

export type MonthSummaryQuery = z.infer<typeof monthSummaryQuerySchema>;

/**
 * ─────────────────────────────────────────────────────────────
 * RECOMMENDATIONS (recommendation)
 * ─────────────────────────────────────────────────────────────
 */

export const recommendationPatchSchema = z.object({
  seen: z.boolean(),
});

export type RecommendationPatchInput = z.infer<typeof recommendationPatchSchema>;

export const recommendationQuerySchema = z.object({
  seen: z
    .union([z.literal("true"), z.literal("false")])
    .optional(), // querystring llega como string
});

export type RecommendationQuery = z.infer<typeof recommendationQuerySchema>;

/**
 * ─────────────────────────────────────────────────────────────
 * CHAT (chat_message)
 * ─────────────────────────────────────────────────────────────
 */

export const chatSendSchema = z.object({
  message: z.string().min(1, "El mensaje no puede estar vacío"),
});

export type ChatSendInput = z.infer<typeof chatSendSchema>;
