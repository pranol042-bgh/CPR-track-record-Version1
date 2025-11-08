export enum EventType {
  COMPRESSIONS_START = 'Compressions Started',
  SHOCK_DELIVERED = 'Shock Delivered',
  EPINEPHRINE_ADMINISTERED = 'Epinephrine',
  AMIODARONE_ADMINISTERED = 'Amiodarone',
  OTHER_MEDICATION = 'Other Medication',
  UNDO_LAST_ACTION = 'Undo Last Action',
  RHYTHM_CHECK_ROSC = 'Rhythm Check: ROSC',
  RHYTHM_CHECK_PULSELESS = 'Rhythm Check: Pulseless',
}

export interface EventLogItem {
  id: string;
  type: EventType;
  timestamp: number; // elapsed seconds from start
  details?: string; // e.g., "200J Biphasic", "Lidocaine 100mg IV"
  actor?: string; // e.g., "By: Nurse Casey"
}

export interface MedicationPrefill {
  name: string;
  dose: string;
  eventType: EventType.EPINEPHRINE_ADMINISTERED | EventType.AMIODARONE_ADMINISTERED | EventType.OTHER_MEDICATION;
}

export interface ModalState {
  isOpen: boolean;
  type: 'shock' | 'medication' | null;
  prefill?: MedicationPrefill;
}

export type CodeStatus = 'inactive' | 'active' | 'review';

export interface AppState {
  codeStatus: CodeStatus;
  startTime: number | null; // Date.now() timestamp
  elapsedTime: number; // in seconds
  events: EventLogItem[];
  timers: {
    rhythmCheck: number | null; // countdown in seconds
    epinephrine: number | null; // countdown in seconds
  };
  summaryCounts: {
    shocks: number;
    epinephrine: number;
    amiodarone: number;
    otherMedications: { [key: string]: number };
  };
  // User-configurable interval (in minutes) for epinephrine dosing reminder
  epinephrineIntervalMinutes: number;
  showRhythmAlert: boolean;
  showPrepareEpiAlert: boolean;
  lastShockEnergy: string | null;
  modal: ModalState;
  // A copy of the state before the last action, for the undo functionality
  previousState: Partial<AppState> | null;
}

export type Action =
  | { type: 'START_CODE' }
  | { type: 'END_CODE' }
  | { type: 'RESET_APP' }
  | { type: 'TICK' }
  | { type: 'LOG_EVENT'; payload: { type: EventType; details?: string; actor?: string; medicationName?: string } }
  | { type: 'DISMISS_RHYTHM_ALERT' }
  | { type: 'DISMISS_PREPARE_EPI_ALERT' }
  | { type: 'OPEN_MODAL'; payload: { type: 'shock' | 'medication'; prefill?: MedicationPrefill } }
  | { type: 'CLOSE_MODAL' }
  | { type: 'UNDO_LAST_ACTION' }
  | { type: 'LOAD_STATE'; payload: AppState }
  | { type: 'SET_EPINEPHRINE_INTERVAL'; payload: { minutes: number } };