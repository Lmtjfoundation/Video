import { ownerNeeded } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Public: tells the sign-up page whether this is the owner (first) account and if a setup code is required. */
export async function GET() {
  const owner = await ownerNeeded();
  return Response.json({ ownerNeeded: owner, codeRequired: owner && !!process.env.SETUP_CODE });
}
