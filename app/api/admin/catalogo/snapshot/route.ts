import { getSession } from "@/lib/auth";
import { diagnoseCatalogSnapshot, syncCatalogSnapshotForAdmin } from "@/lib/catalogoSnapshotDiagnosticoServer";

export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

export async function GET() {
  const result = await diagnoseCatalogSnapshot(await getSession());
  return Response.json(result.body, { status: result.status, headers });
}

export async function POST() {
  const result = await syncCatalogSnapshotForAdmin(await getSession());
  return Response.json(result.body, { status: result.status, headers });
}
