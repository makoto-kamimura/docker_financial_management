import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

export async function GET(_req: NextRequest) {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;

  const { tenantId } = auth.user;
  const meetings = await prisma.shareholderMeeting.findMany({
    where: { tenantId },
    include: { tenant: { select: { id: true, name: true } } },
    orderBy: { meetingDate: "desc" },
  });
  return NextResponse.json({ data: meetings });
}

export async function POST(req: NextRequest) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const { tenantId } = auth.user;
  const body = (await req.json()) as { meetingDate: string; meetingType?: string; agenda: string; resolution?: string };
  if (!body.meetingDate || !body.agenda) {
    return NextResponse.json({ error: "meetingDate, agenda are required" }, { status: 400 });
  }

  const meeting = await prisma.shareholderMeeting.create({
    data: {
      tenantId,
      meetingDate: new Date(body.meetingDate),
      meetingType: body.meetingType ?? "regular",
      agenda: body.agenda,
      resolution: body.resolution ?? null,
    },
  });
  return NextResponse.json({ data: meeting }, { status: 201 });
}
