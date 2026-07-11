import { NextResponse } from "next/server"
import {
  getBooking,
  getCall,
  getEventsByCall,
  getFollowUpsByCall,
  getLead,
} from "@/lib/voice/store"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ callId: string }> },
) {
  const { callId } = await params
  const call = getCall(callId)
  if (!call) {
    return NextResponse.json({ error: "Звонок не найден" }, { status: 404 })
  }
  return NextResponse.json({
    call,
    lead: call.leadId ? (getLead(call.leadId) ?? null) : null,
    booking: call.bookingId ? (getBooking(call.bookingId) ?? null) : null,
    followUps: getFollowUpsByCall(callId),
    events: getEventsByCall(callId),
  })
}
