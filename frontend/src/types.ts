export type Tab = 'overview' | 'schedule' | 'rooms' | 'incidents' | 'recovery' | 'audit';
export interface Overview {
  active_disruptions: number; affected_sessions: number; pending_proposals: number;
  approved_recoveries: number; scheduled_sessions: number;
}
export interface Building { id: number; code: string; name: string }
export interface Room {
  id: number; code: string; building_id: number; capacity: number;
  network: boolean; equipment: Record<string, number>;
}
export interface ClassSession {
  id: number; code: string; title: string; start_at: string; end_at: string;
  attendees: number; needs_network: boolean; room_id: number; room: string;
  original_room_id: number; original_room: string; recovered: boolean;
}
export interface Incident {
  id: number; title: string; kind: 'closure' | 'network' | 'equipment';
  room_id: number | null; building_id: number | null; equipment_kind: string | null;
  quantity_lost: number | null; start_at: string; end_at: string; status: string;
}
export interface Impact {
  session_id: number; code: string; title: string; original_room_id: number;
  original_room: string; reason: string; incident_id: number; start_at: string; end_at: string;
}
export interface Candidate {
  room_id: number; room: string;
  score: { same_building: number; unused_capacity: number; excess_equipment: number; total: number };
}
export interface Rejection { room_id: number; room: string; reasons: string[] }
export interface Explanation {
  session_id: number; code: string; old_room: string; old_room_id: number;
  new_room: string; new_room_id: number; score: Candidate['score'];
}
export interface Proposal {
  id: number; incident_id: number; status: string; score: number;
  generated_at: string; approved_at: string | null;
  assignments: { session_id: number; original_room_id: number; new_room_id: number }[];
  details: { score_breakdown: Candidate['score'][]; explanations: Explanation[];
    rejected: Record<string, Rejection[]>; candidates: Record<string, Candidate[]>; message: string };
}
export interface AuditEvent {
  id: number; occurred_at: string; action: string; actor_id: number | null;
  incident_id: number | null; proposal_id: number | null; details: unknown;
}
