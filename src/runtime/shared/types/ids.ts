import { z } from "zod/v4-mini"



export const requestTraceIdSchema = z.templateLiteral(['req_', z.uuidv7()])
export type RequestTraceId = z.infer<typeof requestTraceIdSchema>

export const sessionTraceIdSchema = z.templateLiteral(['sess_', z.uuidv7()])
export type SessionTraceId = z.infer<typeof sessionTraceIdSchema>