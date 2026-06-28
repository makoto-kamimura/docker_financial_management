import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

export async function GET(req: NextRequest) {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;
  const tenantId = req.nextUrl.searchParams.get("tenantId");
  const meetings = await prisma.shareholderMeeting.findMany({
    where: tenantId ? { tenantId: Number(tenantId) } : undefined,
    include: { tenant: { select: { id: true, name: true } } },
    orderBy: { meetingDate: "desc" },
  });
  return NextResponse.json({ data: meetings });
}

export async function POST(req: NextRequest) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;
  const body = (await req.json()) as {
    tenantId: number;
    meetingDate: string;
    meetingType?: string;
    agenda: string;
    resolution?: string;
  };
  if (!body.tenantId || !body.meetingDate || !body.agenda) {
    return NextResponse.json(
      { error: "tenantId, meetingDate, agenda are required" },
      { status: 400 },
    );
  }
  const meeting = await prisma.shareholderMeeting.create({
    data: {
      tenantId: body.tenantId,
      meetingDate: new Date(body.meetingDate),
      meetingType: body.meetingType ?? "regular",
      agenda: body.agenda,
      resolution: body.resolution ?? null,
    },
  });
  return NextResponse.json({ data: meeting }, { status: 201 });
}
