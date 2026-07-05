import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const { id } = await params;
  const { tenantId } = auth.user;
  const existing = await prisma.shareholderMeeting.findUnique({ where: { id: Number(id), tenantId } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = (await req.json()) as { meetingDate?: string; agenda?: string; resolution?: string };
  const m = await prisma.shareholderMeeting.update({
    where: { id: Number(id) },
    data: {
      ...(body.meetingDate && { meetingDate: new Date(body.meetingDate) }),
      ...(body.agenda && { agenda: body.agenda }),
      resolution: body.resolution ?? undefined,
    },
  });
  return NextResponse.json({ data: m });
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const { id } = await params;
  const { tenantId } = auth.user;
  const existing = await prisma.shareholderMeeting.findUnique({ where: { id: Number(id), tenantId } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  await prisma.shareholderMeeting.delete({ where: { id: Number(id) } });
  return NextResponse.json({ ok: true });
}
