import { plansPayload } from "@/lib/plans-public";

export const dynamic = "force-dynamic";

/** Public plan list for the pricing page. */
export async function GET() {
  return Response.json(await plansPayload());
}
