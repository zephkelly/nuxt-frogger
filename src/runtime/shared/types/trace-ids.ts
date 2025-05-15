import { z } from "zod/v4-mini"
import { requestTraceIdSchema, sessionTraceIdSchema } from "../schemas/trace-ids"



export type RequestTraceId = z.infer<typeof requestTraceIdSchema>
export type SessionTraceId = z.infer<typeof sessionTraceIdSchema>