/** 오류 JSON 계약. issues는 검증 실패에만 붙고, 메시지에는 입력 원문을 넣지 않는다. */
import { z } from "zod";

const issueSchema = z
  .object({
    path: z.string(),
    message: z.string(),
  })
  .strict();

export const errorResponseSchema = z
  .object({
    error: z
      .object({
        code: z.string().min(1),
        message: z.string().min(1),
        path: z.string().min(1),
        issues: z.array(issueSchema).optional(),
      })
      .strict(),
  })
  .strict();

export type ErrorResponse = z.infer<typeof errorResponseSchema>;
