import { NextRequest, NextResponse } from "next/server";
import { importRows, parseCsv } from "@/lib/import";
import { requireRole } from "@/lib/authz";
import { writeAudit } from "@/lib/audit";

export async function POST(req: NextRequest) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const csv = await req.text();
  if (!csv.trim()) return NextResponse.json({ error: "empty body" }, { status: 400 });

  const rows = parseCsv(csv);
  const result = await importRows(rows, auth.user.tenantId);
  await writeAudit(auth.user.id, "import", `financial_records:${result.inserted}`);
  return NextResponse.json(result, { status: result.errors.length ? 207 : 201 });
}
