import { z } from "zod/v4-mini"



export const requestTraceIdSchema = z.templateLiteral(['req_', z.uuidv7()])
export const sessionTraceIdSchema = z.templateLiteral(['sess_', z.uuidv7()])