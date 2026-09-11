import { getSession } from "@/lib/auth";
import { diagnoseCatalog } from "@/lib/catalogoDiagnosticoServer";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  const { status, body } = await diagnoseCatalog(session);
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store", "Vary": "Cookie" },
  });
}
