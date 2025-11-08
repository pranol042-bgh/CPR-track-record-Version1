import React, { useReducer, useEffect, useCallback, useState } from 'react';
import { AppState, Action, EventType, EventLogItem, ModalState, CodeStatus } from './types';
import { 
  HeartbeatIcon, HeartbeatTricolorIcon, PlayIcon, BoltIcon, SyringeIcon, ClockIcon, ChartBarIcon, 
  ListBulletIcon, PlusIcon, ArrowUturnLeftIcon, BellAlertIcon, XMarkIcon,
  CheckCircleIcon, XCircleIcon
} from './components/icons';

const CPR_STATE_KEY = 'cprTrackRecordState';

// Helper Functions
const formatTime = (totalSeconds: number): string => {
  if (totalSeconds < 0) totalSeconds = 0;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

const formatTimeSecondary = (totalSeconds: number): string => {
  if (totalSeconds < 0) totalSeconds = 0;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

const formatRelativeTime = (elapsedSeconds: number, startTime: number | null): string => {
  if (startTime === null) return '';
  const eventTime = startTime + elapsedSeconds * 1000;
  const now = Date.now();
  const diffSeconds = Math.round((now - eventTime) / 1000);

  if (diffSeconds < 60) return `${diffSeconds} sec ago`;
  const diffMinutes = Math.round(diffSeconds / 60);
  return `${diffMinutes} min ago`;
};


// Reducer
const initialState: AppState = {
  codeStatus: 'inactive',
  startTime: null,
  elapsedTime: 0,
  events: [],
  timers: { rhythmCheck: null, epinephrine: null },
  summaryCounts: { shocks: 0, epinephrine: 0, amiodarone: 0, otherMedications: {} },
  epinephrineIntervalMinutes: 3,
  showRhythmAlert: false,
  showPrepareEpiAlert: false,
  lastShockEnergy: null,
  modal: { isOpen: false, type: null },
  previousState: null,
};

const appReducer = (state: AppState, action: Action): AppState => {
  switch (action.type) {
    case 'START_CODE':
      return {
        ...initialState,
        codeStatus: 'active',
        startTime: Date.now(),
        previousState: null // No undo for start
      };
    case 'END_CODE':
      return { ...state, codeStatus: 'review', timers: { rhythmCheck: null, epinephrine: null }, showPrepareEpiAlert: false, showRhythmAlert: false };
    case 'RESET_APP':
        localStorage.removeItem(CPR_STATE_KEY);
        return initialState;
    case 'TICK': {
      if (state.codeStatus !== 'active' || !state.startTime) return state;
      const elapsedTime = (Date.now() - state.startTime) / 1000;
      let newRhythmCheck = state.timers.rhythmCheck !== null ? state.timers.rhythmCheck - 1 : null;
      let newEpinephrine = state.timers.epinephrine !== null ? state.timers.epinephrine - 1 : null;
      let showRhythmAlert = state.showRhythmAlert;
      let showPrepareEpiAlert = state.showPrepareEpiAlert;

      if (newRhythmCheck !== null && newRhythmCheck <= 0) {
        newRhythmCheck = null;
        showRhythmAlert = true;
      }
      if (newEpinephrine !== null && newEpinephrine <= 0) {
        newEpinephrine = null;
        showPrepareEpiAlert = false; // Hide alert when timer expires
      }
      
      if (newEpinephrine === 60) {
        showPrepareEpiAlert = true;
      }

      return { ...state, elapsedTime, timers: { rhythmCheck: newRhythmCheck, epinephrine: newEpinephrine }, showRhythmAlert, showPrepareEpiAlert };
    }
    case 'LOG_EVENT': {
      const { type, details, actor } = action.payload;
      const newEvent: EventLogItem = {
        id: Date.now().toString(),
        type,
        timestamp: state.elapsedTime,
        details,
        actor
      };
      
      const stateBeforeLog = { ...state };
      const newState: AppState = { ...state, events: [newEvent, ...state.events] };

      // Update summaries and timers based on event
      switch(type) {
        case EventType.COMPRESSIONS_START:
          if(newState.timers.rhythmCheck === null) newState.timers.rhythmCheck = 120; // 2 minutes
          break;
        case EventType.SHOCK_DELIVERED:
          newState.summaryCounts.shocks += 1;
          newState.lastShockEnergy = details || null;
          newState.timers.rhythmCheck = 120; // Reset rhythm check timer
          break;
        case EventType.EPINEPHRINE_ADMINISTERED:
          newState.summaryCounts.epinephrine += 1;
          // Use the user-configured interval (minutes) to set the epinephrine timer
          const epiIntervalMinutes = newState.epinephrineIntervalMinutes || 3;
          newState.timers.epinephrine = epiIntervalMinutes * 60;
          newState.showPrepareEpiAlert = false; // Hide alert on administration
          break;
        case EventType.AMIODARONE_ADMINISTERED:
          newState.summaryCounts.amiodarone += 1;
          break;
        case EventType.OTHER_MEDICATION: {
          const medName = action.payload.medicationName || (details ? details.split(' ')[0] : 'Unknown');
          if (medName !== 'Unknown') {
            newState.summaryCounts.otherMedications[medName] = (newState.summaryCounts.otherMedications[medName] || 0) + 1;
          }
          break;
        }
        case EventType.RHYTHM_CHECK_ROSC:
        case EventType.RHYTHM_CHECK_PULSELESS:
          newState.showRhythmAlert = false;
          break;
      }
      // Set previous state for undo, but clear its own previousState to prevent multi-undo
      newState.previousState = {...stateBeforeLog, previousState: null}; 
      return newState;
    }
    case 'DISMISS_RHYTHM_ALERT':
      return { ...state, showRhythmAlert: false };
    case 'DISMISS_PREPARE_EPI_ALERT':
      return { ...state, showPrepareEpiAlert: false };
    case 'SET_EPINEPHRINE_INTERVAL':
      return { ...state, epinephrineIntervalMinutes: action.payload.minutes };
    case 'OPEN_MODAL':
      return { ...state, modal: { isOpen: true, type: action.payload.type, prefill: action.payload.prefill } };
    case 'CLOSE_MODAL':
      return { ...state, modal: { isOpen: false, type: null } };
    case 'UNDO_LAST_ACTION':
      if (state.previousState) {
        return { ...(state.previousState as AppState) };
      }
      return state;
    case 'LOAD_STATE':
        return {
            ...action.payload,
            // When loading, ensure transient alerts are off
            showRhythmAlert: false,
            showPrepareEpiAlert: false,
            // Recalculate elapsed time if it was an active session
            elapsedTime: action.payload.codeStatus === 'active' && action.payload.startTime 
                         ? (Date.now() - action.payload.startTime) / 1000 
                         : action.payload.elapsedTime,
        };
    default:
      return state;
  }
};

// UI Components
const Card: React.FC<{ children: React.ReactNode, className?: string, title?: string, icon?: React.ReactNode }> = ({ children, className, title, icon }) => (
  <div className={`bg-brand-card rounded-lg p-4 flex flex-col ${className}`}>
    {title && (
      <div className="flex items-center text-slate-300 mb-4">
        {icon}
        <h2 className="text-lg font-semibold ml-2">{title}</h2>
      </div>
    )}
    {children}
  </div>
);

const Header: React.FC<{ onEndCode: () => void, codeStatus: CodeStatus, onToggleTheme: () => void, theme: 'light' | 'dark' }> = ({ onEndCode, codeStatus, onToggleTheme, theme }) => (
  <header className="flex items-center justify-between p-4 bg-brand-card rounded-lg mb-6">
    <div className="flex items-center">
      <HeartbeatIcon className="h-8 w-8 text-brand-accent-red" />
      <h1 className="text-2xl font-bold ml-3">CPR Track Record</h1>
      <span className="text-sm text-slate-400 ml-3 mt-1">Code Blue Documentation System</span>
    </div>
    <div className="flex items-center space-x-6">
      <button
        onClick={onToggleTheme}
        className="bg-brand-subtle hover:opacity-90 transition-opacity text-white font-semibold py-2 px-3 rounded-md theme-toggle"
      >
        {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
      </button>
      <div className="text-right">
        <div className="text-slate-400 text-sm">Patient ID</div>
        <div className="font-mono text-lg">12345678</div>
      </div>
      <div className="text-right">
        <div className="text-slate-400 text-sm">Location</div>
        <div className="font-mono text-lg">ICU Room 314</div>
      </div>
      {codeStatus === 'active' && <button onClick={onEndCode} className="bg-brand-accent-red hover:bg-red-700 text-white font-bold py-2 px-4 rounded-lg transition-colors">End Code</button>}
    </div>
  </header>
);

const RhythmCheckAlert: React.FC<{ dispatch: React.Dispatch<Action> }> = ({ dispatch }) => (
    <div className="fixed top-5 left-1/2 -translate-x-1/2 z-50 bg-brand-accent-yellow text-brand-dark p-4 rounded-lg shadow-2xl flex items-center animate-pulse">
        <BellAlertIcon className="h-8 w-8 mr-4"/>
        <div className="font-bold text-xl mr-6">Rhythm Check Required</div>
        <div className="flex items-center space-x-2">
             <button 
                onClick={() => dispatch({ type: 'LOG_EVENT', payload: { type: EventType.RHYTHM_CHECK_ROSC, details: 'Pulse present', actor: 'System' } })} 
                className="bg-green-500 hover:bg-green-600 text-white font-semibold py-1 px-3 rounded-md transition-colors text-base"
            >
                ROSC
            </button>
            <button 
                onClick={() => dispatch({ type: 'LOG_EVENT', payload: { type: EventType.RHYTHM_CHECK_PULSELESS, details: 'No pulse detected', actor: 'System' } })} 
                className="bg-red-500 hover:bg-red-600 text-white font-semibold py-1 px-3 rounded-md transition-colors text-base"
            >
                Pulseless
            </button>
            <button 
                onClick={() => dispatch({ type: 'DISMISS_RHYTHM_ALERT' })} 
                className="bg-slate-800/20 hover:bg-slate-800/40 text-sm font-semibold py-1 px-3 rounded-md transition-colors"
            >
                Dismiss
            </button>
        </div>
    </div>
);

const PrepareEpiAlert: React.FC<{ dispatch: React.Dispatch<Action> }> = ({ dispatch }) => (
    <div className="fixed top-24 left-1/2 -translate-x-1/2 z-40 bg-brand-accent-blue text-white p-3 rounded-lg shadow-2xl flex items-center">
        <BellAlertIcon className="h-6 w-6 mr-3"/>
        <div className="font-semibold text-lg mr-5">Prepare Next Epinephrine Dose</div>
        <button
            onClick={() => dispatch({ type: 'DISMISS_PREPARE_EPI_ALERT' })}
            className="bg-blue-800/50 hover:bg-blue-800/80 text-sm font-semibold py-1 px-3 rounded-md transition-colors"
        >
            Dismiss
        </button>
    </div>
);


const EventRecording: React.FC<{ dispatch: React.Dispatch<Action>, epiInterval: number }> = ({ dispatch, epiInterval }) => {
  const log = (type: EventType, details?: string) => dispatch({ type: 'LOG_EVENT', payload: { type, details, actor: 'By: Nurse Casey' } });
  const setEpiInterval = (minutes: number) => dispatch({ type: 'SET_EPINEPHRINE_INTERVAL', payload: { minutes } });

  return (
    <Card title="Event Recording" icon={<ListBulletIcon className="h-6 w-6"/>}>
      <div className="grid grid-cols-2 gap-3">
        <button onClick={() => log(EventType.COMPRESSIONS_START)} className="bg-brand-accent-green hover:opacity-90 transition-opacity text-white font-bold py-3 px-4 rounded-lg flex items-center justify-center"><PlayIcon className="h-5 w-5 mr-2"/> Start Compressions</button>
        <button onClick={() => dispatch({type: 'OPEN_MODAL', payload: {type: 'shock'}})} className="bg-brand-accent-yellow hover:opacity-90 transition-opacity text-brand-dark font-bold py-3 px-4 rounded-lg flex items-center justify-center"><BoltIcon className="h-5 w-5 mr-2"/> Shock Delivered</button>
      </div>
      <h3 className="text-slate-300 mt-6 mb-2 text-md font-semibold">Common Medications</h3>
      <div className="space-y-3">
        <div className="bg-brand-accent-blue hover:opacity-90 w-full transition-opacity text-white font-bold py-3 px-4 rounded-lg flex items-center justify-between">
          <button 
            onClick={() => dispatch({ type: 'OPEN_MODAL', payload: { type: 'medication', prefill: { name: 'Epinephrine', dose: '1mg IV Push', eventType: EventType.EPINEPHRINE_ADMINISTERED } } })}
            className="flex items-center"
          >
            <SyringeIcon className="h-5 w-5 mr-3"/>Epinephrine
          </button>
          <div className="flex items-center space-x-3">
            <select
              value={epiInterval}
              onChange={(e) => setEpiInterval(Number(e.target.value))}
              onClick={(e) => e.stopPropagation()}
              className="bg-blue-800/50 hover:bg-blue-800/80 text-xs font-bold rounded px-2 py-1 cursor-pointer border-none outline-none appearance-none"
            >
              <option value={1}>1m</option>
              <option value={2}>2m</option>
              <option value={3}>3m</option>
              <option value={4}>4m</option>
              <option value={5}>5m</option>
            </select>
            <span className="bg-blue-800 text-xs font-bold px-2 py-1 rounded">1mg</span>
          </div>
        </div>
        <button onClick={() => dispatch({ type: 'OPEN_MODAL', payload: { type: 'medication', prefill: { name: 'Amiodarone', dose: '300mg IV Push', eventType: EventType.AMIODARONE_ADMINISTERED } } })} className="bg-brand-accent-purple hover:opacity-90 w-full transition-opacity text-white font-bold py-3 px-4 rounded-lg flex items-center justify-between"><div className="flex items-center"><SyringeIcon className="h-5 w-5 mr-3"/>Amiodarone</div> <span className="bg-purple-800 text-xs font-bold px-2 py-1 rounded">300mg</span></button>
        <button onClick={() => dispatch({ type: 'OPEN_MODAL', payload: { type: 'medication', prefill: { name: 'Amiodarone', dose: '150mg IV Push', eventType: EventType.AMIODARONE_ADMINISTERED } } })} className="bg-brand-accent-purple hover:opacity-90 w-full transition-opacity text-white font-bold py-3 px-4 rounded-lg flex items-center justify-between"><div className="flex items-center"><SyringeIcon className="h-5 w-5 mr-3"/>Amiodarone</div> <span className="bg-purple-800 text-xs font-bold px-2 py-1 rounded">150mg</span></button>
        <button onClick={() => dispatch({ type: 'OPEN_MODAL', payload: { type: 'medication', prefill: { name: '50% Glucose', dose: '50ml IV Push', eventType: EventType.OTHER_MEDICATION } } })} className="bg-brand-accent-yellow hover:opacity-90 w-full transition-opacity text-brand-dark font-bold py-3 px-4 rounded-lg flex items-center justify-between"><div className="flex items-center"><SyringeIcon className="h-5 w-5 mr-3"/>50% Glucose</div> <span className="bg-yellow-800 text-yellow-100 text-xs font-bold px-2 py-1 rounded">50ml</span></button>
        <button onClick={() => dispatch({type: 'OPEN_MODAL', payload: {type: 'medication'}})} className="bg-brand-subtle hover:opacity-90 w-full transition-opacity text-slate-200 font-bold py-3 px-4 rounded-lg flex items-center justify-center mt-2"><PlusIcon className="h-5 w-5 mr-2"/> Other Medication</button>
      </div>
       <button onClick={() => dispatch({type: 'UNDO_LAST_ACTION'})} className="bg-brand-subtle hover:opacity-90 w-full transition-opacity text-slate-200 font-bold py-3 px-4 rounded-lg flex items-center justify-center mt-4"><ArrowUturnLeftIcon className="h-5 w-5 mr-2"/> Undo Last Action</button>
    </Card>
  );
};

const EventLog: React.FC<{ events: EventLogItem[], startTime: number | null }> = ({ events, startTime }) => {
    const iconMap: { [key in EventType]?: React.ReactNode } = {
        [EventType.COMPRESSIONS_START]: <PlayIcon className="h-5 w-5 text-green-400"/>,
        [EventType.SHOCK_DELIVERED]: <BoltIcon className="h-5 w-5 text-yellow-400"/>,
        [EventType.EPINEPHRINE_ADMINISTERED]: <SyringeIcon className="h-5 w-5 text-blue-400"/>,
        [EventType.AMIODARONE_ADMINISTERED]: <SyringeIcon className="h-5 w-5 text-purple-400"/>,
        [EventType.OTHER_MEDICATION]: <SyringeIcon className="h-5 w-5 text-slate-400"/>,
        [EventType.RHYTHM_CHECK_ROSC]: <CheckCircleIcon className="h-5 w-5 text-green-400"/>,
        [EventType.RHYTHM_CHECK_PULSELESS]: <XCircleIcon className="h-5 w-5 text-red-400"/>,
    };
    return (
    <Card title="Event Log" icon={<ClockIcon className="h-6 w-6"/>}>
        <div className="space-y-3 h-96 overflow-y-auto pr-2">
            {events.length === 0 && <p className="text-slate-400 text-center py-10">No events logged yet.</p>}
            {events.map(event => (
                <div key={event.id} className="flex items-start justify-between bg-brand-dark/50 p-3 rounded-lg">
                    <div className="flex items-start">
                        <div className="flex-shrink-0 h-8 w-8 rounded-full bg-brand-subtle flex items-center justify-center mr-3">{iconMap[event.type]}</div>
                        <div>
                            <p className="font-semibold text-white">{event.type}</p>
                            <p className="text-sm text-slate-400">{event.details}</p>
                        </div>
                    </div>
                    <div className="text-right flex-shrink-0 ml-4">
                        <p className="font-mono text-slate-300">{formatTime(event.timestamp)}</p>
                        <p className="text-xs text-slate-500">{formatRelativeTime(event.timestamp, startTime)}</p>
                    </div>
                </div>
            ))}
        </div>
    </Card>
    );
};

const SummaryCounts: React.FC<{ counts: AppState['summaryCounts'], lastShockEnergy: string | null }> = ({ counts, lastShockEnergy }) => (
    <Card title="Summary Counts" icon={<ChartBarIcon className="h-6 w-6"/>}>
        <div className="grid grid-cols-3 gap-3 text-center">
            <div>
                <p className="text-4xl font-bold text-yellow-400">{counts.shocks}</p>
                <p className="text-slate-400 text-sm">Total Shocks</p>
                {lastShockEnergy && <p className="text-xs text-slate-500">Last: {lastShockEnergy}</p>}
            </div>
            <div>
                <p className="text-4xl font-bold text-blue-400">{counts.epinephrine}</p>
                <p className="text-slate-400 text-sm">Epinephrine</p>
                 <p className="text-xs text-slate-500">Total doses</p>
            </div>
             <div>
                <p className="text-4xl font-bold text-purple-400">{counts.amiodarone}</p>
                <p className="text-slate-400 text-sm">Amiodarone</p>
                 <p className="text-xs text-slate-500">Total doses</p>
            </div>
        </div>
        {Object.keys(counts.otherMedications).length > 0 && <div className="mt-4 pt-4 border-t border-brand-subtle">
             <h4 className="text-slate-300 mb-2 font-semibold">Other Medications:</h4>
             <ul className="text-slate-400 text-sm list-disc list-inside">
                 {Object.entries(counts.otherMedications).map(([name, count]) => (
                     <li key={name}>{name} &times; {count}</li>
                 ))}
             </ul>
        </div>}
    </Card>
);

const TimerDisplay: React.FC<{ label: string, time: number | null, active: boolean, nextLabel?: string, pulseColor?: string }> = ({ label, time, active, nextLabel, pulseColor }) => {
    const isCritical = active && time !== null && time <= 30;
    
    const timeClassName = `text-4xl font-mono font-bold transition-colors ${
        isCritical && pulseColor
        ? `${pulseColor} animate-pulse`
        : active
        ? 'text-white'
        : 'text-slate-500'
    }`;
    
    return (
        <Card className="items-center justify-center text-center">
            <p className="text-slate-400 text-sm mb-1">{label}</p>
            <p className={timeClassName}>
                {time !== null ? formatTimeSecondary(time) : '--:--'}
            </p>
            {nextLabel && <p className={`text-xs mt-1 ${active ? 'text-slate-300' : 'text-slate-600'}`}>{nextLabel}</p>}
            {active && !isCritical && <div className="flex items-center text-green-400 text-xs mt-2"><div className="h-2 w-2 bg-green-400 rounded-full mr-1.5 animate-pulse"></div>Active</div>}
            {isCritical && <div className="flex items-center text-yellow-400 text-xs mt-2"><div className={`h-2 w-2 ${pulseColor?.replace('text-', 'bg-')} rounded-full mr-1.5 animate-ping`}></div>Critical</div>}
        </Card>
    );
};

const CurrentStatus: React.FC = () => (
    <Card title="Current Status">
        <div className="space-y-3">
            <div className="flex justify-between items-center bg-brand-dark/50 p-3 rounded-lg">
                <div className="flex items-center">
                    <div className="h-2 w-2 bg-green-500 rounded-full mr-3 animate-pulse"></div>
                    <span className="font-semibold text-green-400">Compressions Active</span>
                </div>
                <span className="text-slate-400">Ongoing</span>
            </div>
            <div className="flex justify-between items-center bg-brand-dark/50 p-3 rounded-lg">
                 <div className="flex items-center">
                    <div className="h-2 w-2 bg-slate-500 rounded-full mr-3"></div>
                    <span className="font-semibold text-slate-300">Airway</span>
                </div>
                <span className="text-slate-400">ET Tube Secured</span>
            </div>
             <div className="flex justify-between items-center bg-brand-dark/50 p-3 rounded-lg">
                 <div className="flex items-center">
                    <div className="h-2 w-2 bg-slate-500 rounded-full mr-3"></div>
                    <span className="font-semibold text-slate-300">Access</span>
                </div>
                <span className="text-slate-400">2x IV, 1x IO</span>
            </div>
        </div>
    </Card>
);

const Modal: React.FC<{
    modalState: ModalState,
    dispatch: React.Dispatch<Action>
}> = ({ modalState, dispatch }) => {
    const [shockEnergy, setShockEnergy] = useState('200');
    const [medicationName, setMedicationName] = useState('');
    const [medicationDose, setMedicationDose] = useState('');

    useEffect(() => {
        if (modalState.isOpen && modalState.type === 'medication') {
            if (modalState.prefill) {
                setMedicationName(modalState.prefill.name);
                setMedicationDose(modalState.prefill.dose);
            } else {
                setMedicationName('');
                setMedicationDose('');
            }
        }
    }, [modalState.isOpen, modalState.type, modalState.prefill]);

    const handleClose = () => dispatch({ type: 'CLOSE_MODAL' });

    const handleShockSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        dispatch({ type: 'LOG_EVENT', payload: { type: EventType.SHOCK_DELIVERED, details: `${shockEnergy}J Biphasic`, actor: 'By: Nurse Casey' } });
        handleClose();
    };

    const handleMedicationSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!medicationName.trim() || !medicationDose.trim()) return;

        const eventType = modalState.prefill?.eventType || EventType.OTHER_MEDICATION;
        const details = eventType === EventType.OTHER_MEDICATION 
            ? `${medicationName} ${medicationDose}` 
            : medicationDose;
        
        dispatch({ type: 'LOG_EVENT', payload: { type: eventType, details: details, actor: 'By: Nurse Casey', medicationName: medicationName } });
        handleClose();
    };

    if (!modalState.isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={handleClose}>
            <div className="bg-brand-card rounded-lg shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between p-4 border-b border-brand-subtle">
                    <h3 className="text-xl font-bold">{modalState.type === 'shock' ? 'Log Shock' : (modalState.prefill ? `Log ${modalState.prefill.name}` : 'Log Other Medication')}</h3>
                    <button onClick={handleClose} className="text-slate-400 hover:text-white"><XMarkIcon className="h-6 w-6"/></button>
                </div>
                {modalState.type === 'shock' && (
                    <form onSubmit={handleShockSubmit} className="p-6 space-y-4">
                        <label htmlFor="energy" className="block text-sm font-medium text-slate-300">Energy Level (Joules)</label>
                        <input
                            id="energy"
                            type="number"
                            value={shockEnergy}
                            onChange={(e) => setShockEnergy(e.target.value)}
                            className="w-full bg-brand-dark border border-brand-subtle rounded-md p-2 text-white placeholder-slate-500 focus:ring-brand-accent-yellow focus:border-brand-accent-yellow"
                            placeholder="e.g., 200"
                            autoFocus
                        />
                        <button type="submit" className="w-full bg-brand-accent-yellow text-brand-dark font-bold py-2 px-4 rounded-lg hover:opacity-90 transition-opacity">Log Shock</button>
                    </form>
                )}
                {modalState.type === 'medication' && (
                    <form onSubmit={handleMedicationSubmit} className="p-6 space-y-4">
                        <div>
                            <label htmlFor="med-name" className="block text-sm font-medium text-slate-300">Medication Name</label>
                            <input
                                id="med-name"
                                type="text"
                                value={medicationName}
                                onChange={(e) => setMedicationName(e.target.value)}
                                className="w-full mt-1 bg-brand-dark border border-brand-subtle rounded-md p-2 text-white placeholder-slate-500 focus:ring-brand-accent-blue focus:border-brand-accent-blue disabled:bg-brand-subtle/50 disabled:cursor-not-allowed"
                                placeholder="e.g., Lidocaine"
                                autoFocus={!modalState.prefill}
                                disabled={!!modalState.prefill}
                            />
                        </div>
                        <div>
                            <label htmlFor="med-dose" className="block text-sm font-medium text-slate-300">Dose & Route</label>
                            <input
                                id="med-dose"
                                type="text"
                                value={medicationDose}
                                onChange={(e) => setMedicationDose(e.target.value)}
                                className="w-full mt-1 bg-brand-dark border border-brand-subtle rounded-md p-2 text-white placeholder-slate-500 focus:ring-brand-accent-blue focus:border-brand-accent-blue"
                                placeholder="e.g., 100mg IV Push"
                                autoFocus={!!modalState.prefill}
                            />
                        </div>
                        <button type="submit" className="w-full bg-brand-accent-blue text-white font-bold py-2 px-4 rounded-lg hover:opacity-90 transition-opacity">Log Medication</button>
                    </form>
                )}
            </div>
        </div>
    );
};

const CodeScreen: React.FC<{ state: AppState, dispatch: React.Dispatch<Action>, onToggleTheme: () => void, theme: 'light' | 'dark' }> = ({ state, dispatch, onToggleTheme, theme }) => (
  <main className="p-6 max-w-7xl mx-auto">
    <Header onEndCode={() => dispatch({ type: 'END_CODE' })} codeStatus={state.codeStatus} onToggleTheme={onToggleTheme} theme={theme} />
    {state.showRhythmAlert && <RhythmCheckAlert dispatch={dispatch} />}
    {state.showPrepareEpiAlert && <PrepareEpiAlert dispatch={dispatch} />}
    
    <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
        {/* Column 1: Actions & Log */}
        <div className="lg:col-span-1 xl:col-span-1 flex flex-col gap-6">
            <EventRecording dispatch={dispatch} epiInterval={state.epinephrineIntervalMinutes} />
            <EventLog events={state.events} startTime={state.startTime} />
        </div>

        {/* Column 2: Timers & Summaries */}
        <div className="lg:col-span-1 xl:col-span-2 flex flex-col gap-6">
            <Card className="items-center justify-center h-52">
                <p className="text-slate-400 text-lg mb-2">CODE DURATION</p>
                <h1 className="text-7xl font-mono font-bold tracking-wider">{formatTime(state.elapsedTime)}</h1>
                <p className="text-slate-500 font-mono">HH:MM:SS</p>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <TimerDisplay label="RHYTHM CHECK" time={state.timers.rhythmCheck} active={state.timers.rhythmCheck !== null} nextLabel={state.timers.rhythmCheck !== null ? `Next in ${formatTimeSecondary(state.timers.rhythmCheck)}` : ''} pulseColor="text-yellow-400" />
                <TimerDisplay label="EPINEPHRINE" time={state.timers.epinephrine} active={state.timers.epinephrine !== null} nextLabel={state.timers.epinephrine !== null ? `Next dose in ${formatTimeSecondary(state.timers.epinephrine)}` : ''} pulseColor="text-blue-400" />
            </div>
            
            <SummaryCounts counts={state.summaryCounts} lastShockEnergy={state.lastShockEnergy} />
            <CurrentStatus />
        </div>
    </div>
  </main>
);

const SummaryScreen: React.FC<{ state: AppState, dispatch: React.Dispatch<Action>, onToggleTheme: () => void, theme: 'light' | 'dark' }> = ({ state, dispatch, onToggleTheme, theme }) => (
    <main className="p-6 max-w-4xl mx-auto">
        <Header onEndCode={() => {}} codeStatus={state.codeStatus} onToggleTheme={onToggleTheme} theme={theme} />
        <div className="bg-brand-card rounded-lg p-6 mb-6">
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-3xl font-bold">Code Event Summary</h2>
                    <p className="text-slate-400">This code has been ended. Review the summary below.</p>
                </div>
                <button 
                    onClick={() => dispatch({ type: 'RESET_APP' })} 
                    className="bg-brand-accent-green hover:opacity-90 transition-opacity text-white font-bold py-3 px-6 rounded-lg text-lg flex items-center justify-center"
                >
                    <PlayIcon className="h-6 w-6 mr-2"/> Start New Code
                </button>
            </div>
        </div>

        <div className="flex flex-col gap-6">
            <Card className="items-center justify-center">
                <p className="text-slate-400 text-lg mb-2">FINAL CODE DURATION</p>
                <h1 className="text-7xl font-mono font-bold tracking-wider">{formatTime(state.elapsedTime)}</h1>
            </Card>
            
            <SummaryCounts counts={state.summaryCounts} lastShockEnergy={state.lastShockEnergy} />
            <EventLog events={state.events} startTime={state.startTime} />
        </div>
    </main>
);


const StartScreen: React.FC<{ onStart: () => void, onLoadState: (state: AppState) => void, previousStateStatus: CodeStatus | 'none', onToggleTheme: () => void, theme: 'light' | 'dark' }> = ({ onStart, onLoadState, previousStateStatus, onToggleTheme, theme }) => {
    
    const handleAction = () => {
        const savedStateJSON = localStorage.getItem(CPR_STATE_KEY);
        if (savedStateJSON) {
            const savedState = JSON.parse(savedStateJSON);
            onLoadState(savedState);
        }
    };

    const canResume = previousStateStatus === 'active';
    const canReview = previousStateStatus === 'review';
    const hasPreviousSession = canResume || canReview;

    const buttonText = canResume ? 'Resume Code' : 'Review Last Code';
    const buttonColor = canResume ? 'bg-brand-accent-blue' : 'bg-brand-subtle';


    return (
        <div className="flex flex-col items-center justify-center min-h-screen text-center p-4 relative">
            <button onClick={onToggleTheme} className="absolute top-4 right-4 bg-brand-subtle hover:opacity-90 transition-opacity text-white font-semibold py-2 px-3 rounded-md theme-toggle">
                {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
            </button>
            <HeartbeatTricolorIcon className="h-24 w-24 mb-4"/>
            <h1 className="text-5xl font-bold mb-2">CPR Track Record</h1>
            <p className="text-slate-400 max-w-xl mb-8">
                A digital application to streamline and improve the documentation of in-hospital cardiac arrest events.
            </p>
            <div className="flex items-center space-x-4">
                <button onClick={onStart} className="bg-brand-accent-green hover:opacity-90 transition-opacity text-white font-bold py-4 px-8 rounded-lg text-2xl flex items-center justify-center">
                    <PlayIcon className="h-8 w-8 mr-3"/> Start New Code
                </button>
                <button 
                    onClick={handleAction} 
                    disabled={!hasPreviousSession}
                    className={`${buttonColor} hover:opacity-90 transition-opacity text-white font-bold py-4 px-8 rounded-lg text-2xl flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-brand-subtle`}
                >
                    {buttonText}
                </button>
            </div>
            {hasPreviousSession && 
                <p className="text-sm text-slate-500 mt-4">A previous session is available. Starting a new code will clear it.</p>
            }
        </div>
    );
};


const App = () => {
  const [state, dispatch] = useReducer(appReducer, initialState);
  const [isInitialized, setIsInitialized] = useState(false);
  const [previousStateStatus, setPreviousStateStatus] = useState<CodeStatus | 'none'>('none');
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('theme');
    return (saved === 'light' || saved === 'dark') ? (saved as 'light' | 'dark') : 'dark';
  });

  useEffect(() => {
    const isLight = theme === 'light';
    document.body.classList.toggle('light', isLight);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  }, []);

  // Main timer tick
  useEffect(() => {
    if (state.codeStatus === 'active') {
      const timer = setInterval(() => {
        dispatch({ type: 'TICK' });
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [state.codeStatus]);
  
  const loadState = useCallback((savedState: AppState) => {
    dispatch({ type: 'LOAD_STATE', payload: savedState });
  }, []);

  // Check for saved state on initial mount
  useEffect(() => {
    if(!isInitialized){
        try {
            const savedStateJSON = localStorage.getItem(CPR_STATE_KEY);
            if (savedStateJSON) {
                const savedState = JSON.parse(savedStateJSON);
                setPreviousStateStatus(savedState.codeStatus || 'inactive');
            } else {
                setPreviousStateStatus('none');
            }
        } catch (error) {
            console.error("Failed to check state from localStorage", error);
            setPreviousStateStatus('none');
        } finally {
            setIsInitialized(true);
        }
    }
  }, [isInitialized]);

  // Save state to localStorage whenever it changes
  useEffect(() => {
    if (isInitialized) {
        try {
            if (state.codeStatus !== 'inactive') {
                 // Don't save transient UI state like modals or the undo buffer.
                 const stateToSave = { ...state, modal: initialState.modal, previousState: null, showRhythmAlert: false, showPrepareEpiAlert: false };
                 localStorage.setItem(CPR_STATE_KEY, JSON.stringify(stateToSave));
                 setPreviousStateStatus(state.codeStatus);
            } else {
                 localStorage.removeItem(CPR_STATE_KEY);
                 setPreviousStateStatus('none');
            }
        } catch (error) {
            console.error("Failed to save state to localStorage", error);
        }
    }
  }, [state, isInitialized]);
  
  const handleStart = () => {
      // Warn user if they are about to overwrite a session
      if(previousStateStatus !== 'none') {
          if(!window.confirm('Starting a new code will clear the previous session. Are you sure?')) {
              return;
          }
      }
      dispatch({type: 'RESET_APP'});
      dispatch({type: 'START_CODE'});
  };

  if (!isInitialized) {
      return null; // or a loading spinner
  }

  const renderContent = () => {
    switch (state.codeStatus) {
        case 'active':
            return <CodeScreen state={state} dispatch={dispatch} onToggleTheme={toggleTheme} theme={theme} />;
        case 'review':
            return <SummaryScreen state={state} dispatch={dispatch} onToggleTheme={toggleTheme} theme={theme} />;
        case 'inactive':
        default:
            return <StartScreen onStart={handleStart} onLoadState={loadState} previousStateStatus={previousStateStatus} onToggleTheme={toggleTheme} theme={theme} />;
    }
  };

  return (
    <>
        <Modal modalState={state.modal} dispatch={dispatch} />
        {renderContent()}
    </>
  );
};

export default App;
