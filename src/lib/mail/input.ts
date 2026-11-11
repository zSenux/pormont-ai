import { z } from "zod";

// Eingabe für „Mail senden“ / „Entwurf“ (Werkzeug + Freigabe-Karte)
const addressList = z
  .string()
  .trim()
  .min(3)
  .max(1000)
  .refine((v) => v.split(/[,;]/).map((x) => x.trim()).filter(Boolean).every((x) => /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(x.replace(/^.*<(.+)>$/, "$1"))), "Ungültige E-Mail-Adresse.");

export const mailInput = z.object({
  an: addressList,
  cc: addressList.optional(),
  betreff: z.string().trim().min(1).max(250),
  text: z.string().trim().min(1).max(20000),
  antwortAuf: z.string().max(500).nullish(),
  referenzen: z.array(z.string().max(500)).max(30).optional(),
});
export type MailInput = z.infer<typeof mailInput>;
