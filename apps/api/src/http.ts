import { HttpException } from "@nestjs/common";
import { ZodType } from "zod";

export function parse<T>(schema: ZodType<T, any, any>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) throw new HttpException({ errors: r.error.flatten() }, 422);
  return r.data;
}

export const cents = (euros: number) => Math.round(euros * 100);
export const euros = (c: number) => c / 100;
