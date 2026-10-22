/** 헬스 응답에 정해진 두 필드만 허용한다. 환경 값이 섞여 나가지 않게 strict로 둔다. */
import { z } from "zod";

export const healthResponseSchema = z
  .object({
    status: z.literal("ok"),
    service: z.string().min(1),
  })
  .strict();

export type HealthResponse = z.infer<typeof healthResponseSchema>;
