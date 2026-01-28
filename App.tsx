
import React, { useState, useEffect } from 'react';
import { ChatInterface } from './components/ChatInterface';
import { LiveInterface } from './components/LiveInterface';
import { AppMode, ChatSession, Message } from './types';
import { WARVI_INITIAL_GREETING } from './constants';

const SESSIONS_STORAGE_KEY = 'waso_sessions_v2';

const App: React.FC = () => {
  const [mode, setMode] = useState<AppMode>(AppMode.CHAT);
  const [sessions, setSessions] = useState<ChatSession[]>(() => {
    const saved = localStorage.getItem(SESSIONS_STORAGE_KEY);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        return [];
      }
    }
    return [];
  });
  
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(() => {
    return sessions.length > 0 ? sessions[0].id : null;
  });
  
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(sessions));
  }, [sessions]);

  const createNewChat = () => {
    const newId = Date.now().toString();
    const newSession: ChatSession = {
      id: newId,
      title: 'New Chat',
      messages: [{ role: 'model', parts: [{ text: WARVI_INITIAL_GREETING }], timestamp: Date.now() }],
      timestamp: Date.now()
    };
    setSessions(prev => [newSession, ...prev]);
    setCurrentSessionId(newId);
    setMode(AppMode.CHAT);
    setIsHistoryOpen(false);
  };

  const handleUpdateMessages = (sessionId: string, messages: Message[]) => {
    setSessions(prev => prev.map(s => {
      if (s.id === sessionId) {
        let newTitle = s.title;
        if (s.title === 'New Chat' || s.title === 'Chat Session') {
          const firstUserMsg = messages.find(m => m.role === 'user');
          if (firstUserMsg) {
            newTitle = firstUserMsg.parts[0].text.slice(0, 30) + (firstUserMsg.parts[0].text.length > 30 ? '...' : '');
          }
        }
        return { ...s, messages, title: newTitle, timestamp: Date.now() };
      }
      return s;
    }));
  };

  const deleteSession = (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSessions(prev => prev.filter(s => s.id !== sessionId));
    if (currentSessionId === sessionId) {
      setCurrentSessionId(null);
    }
  };

  const currentSession = sessions.find(s => s.id === currentSessionId);

  return (
    <div className="flex h-screen w-screen bg-warvi-gradient text-white overflow-hidden font-['Inter'] flex-col relative">
      {/* History Drawer Overlay */}
      {isHistoryOpen && (
        <div 
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[45] transition-opacity duration-300"
          onClick={() => setIsHistoryOpen(false)}
        />
      )}

      {/* History Drawer */}
      <aside className={`fixed top-0 left-0 h-full w-[280px] md:w-[320px] glass-card bg-black/90 z-50 border-r border-white/10 transform transition-transform duration-300 ease-out shadow-2xl ${isHistoryOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex flex-col h-full p-4 md:p-6">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-xl font-black uppercase tracking-widest text-blue-400">History</h2>
            <button onClick={() => setIsHistoryOpen(false)} className="p-2 hover:bg-white/10 rounded-lg transition-colors">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto space-y-2 pr-2">
            {sessions.map(s => (
              <div 
                key={s.id}
                onClick={() => {
                  setCurrentSessionId(s.id);
                  setMode(AppMode.CHAT);
                  setIsHistoryOpen(false);
                }}
                className={`group flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-all duration-200 ${
                  currentSessionId === s.id 
                    ? 'bg-blue-600/20 border-blue-500/40 text-white' 
                    : 'bg-white/5 border-white/5 text-gray-400 hover:bg-white/10 hover:border-white/10 hover:text-white'
                }`}
              >
                <div className="flex items-center gap-3 overflow-hidden">
                  <svg className="w-4 h-4 shrink-0 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>
                  <span className="text-xs font-bold truncate">{s.title}</span>
                </div>
                <button 
                  onClick={(e) => deleteSession(s.id, e)}
                  className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-400 transition-all"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                </button>
              </div>
            ))}
            {sessions.length === 0 && (
              <div className="text-center py-10 opacity-30 italic text-sm uppercase tracking-widest">No history detected</div>
            )}
          </div>

          <button 
            onClick={createNewChat}
            className="mt-6 flex items-center justify-center gap-3 w-full py-4 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-black uppercase tracking-widest text-xs transition-all active:scale-95 shadow-lg shadow-blue-500/20"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 4v16m8-8H4" /></svg>
            New Chat
          </button>
        </div>
      </aside>

      {/* Professional Navigation Header */}
      <header className="h-16 md:h-20 flex items-center justify-between px-4 md:px-10 border-b border-white/5 glass-card z-30 shrink-0">
        <div className="flex items-center gap-2 md:gap-4 lg:w-1/3">
          <button 
            onClick={() => setIsHistoryOpen(true)}
            className="p-2 md:p-3 rounded-xl text-gray-400 hover:text-blue-400 hover:bg-white/5 transition-all active:scale-90"
            title="Menu"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 md:w-8 md:h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          <div className="flex items-center gap-2 md:gap-3 cursor-pointer select-none" onClick={() => setMode(AppMode.CHAT)}>
            <div className="w-8 h-8 md:w-10 md:h-10 shrink-0 flex items-center justify-center">
               <img 
                 src="https://i.ibb.co.com/Hp1PLn3q/Ai-removebg-preview.png" 
                 alt="WASO Logo" 
                 className="w-full h-full object-contain filter drop-shadow-[0_0_8px_rgba(59,130,246,0.3)]"
               />
            </div>
            <div className="flex flex-col justify-center leading-none gap-0.5">
              <h1 className="text-lg md:text-xl font-black tracking-widest text-white uppercase">WASO</h1>
              <span className="text-[7px] md:text-[8px] text-blue-400 font-bold uppercase tracking-widest opacity-80 hidden md:block">Ai Assistant</span>
            </div>
          </div>
        </div>

        <nav className="flex items-center gap-1 md:gap-2 bg-white/5 p-1 rounded-xl md:rounded-2xl border border-white/5">
          <button
            onClick={() => setMode(AppMode.CHAT)}
            className={`flex items-center gap-2 px-3 md:px-6 py-1.5 md:py-2 rounded-lg md:rounded-xl transition-all duration-300 ${
              mode === AppMode.CHAT 
                ? 'bg-blue-600 text-white shadow-[0_0_20px_rgba(37,99,235,0.3)]' 
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
            </svg>
            <span className="text-[10px] md:text-xs font-black uppercase tracking-widest">Chat</span>
          </button>
          <button
            onClick={() => setMode(AppMode.LIVE)}
            className={`flex items-center gap-2 px-3 md:px-6 py-1.5 md:py-2 rounded-lg md:rounded-xl transition-all duration-300 ${
              mode === AppMode.LIVE 
                ? 'bg-blue-600 text-white shadow-[0_0_20px_rgba(37,99,235,0.3)]' 
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
            <span className="text-[10px] md:text-xs font-black uppercase tracking-widest">Live</span>
          </button>
        </nav>
        
        <div className="hidden lg:block lg:w-1/3"></div>
      </header>

      <main className="flex-1 overflow-hidden relative">
        {mode === AppMode.CHAT ? (
          currentSessionId ? (
            <ChatInterface 
              sessionId={currentSessionId}
              initialMessages={currentSession?.messages || []}
              onUpdateMessages={(msgs) => handleUpdateMessages(currentSessionId, msgs)}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center p-8 space-y-6 animate-in fade-in zoom-in-95 duration-700">
               <div className="w-24 h-24 md:w-32 md:h-32 p-4 glass-card rounded-[2rem] border-blue-500/20 shadow-[0_0_40px_rgba(59,130,246,0.1)]">
                 <img src="https://i.ibb.co.com/Hp1PLn3q/Ai-removebg-preview.png" className="w-full h-full object-contain filter-none" />
               </div>
               <div className="space-y-2">
                 <h2 className="text-2xl md:text-4xl font-black text-white uppercase tracking-widest">Awaiting Chat</h2>
                 <p className="text-gray-500 text-xs md:text-sm font-bold uppercase tracking-[0.3em]">Initialize a new chat or select from history</p>
               </div>
               <button 
                 onClick={createNewChat}
                 className="px-10 py-4 bg-blue-600 hover:bg-blue-500 text-white rounded-2xl font-black uppercase tracking-widest text-sm transition-all shadow-[0_10px_30px_rgba(37,99,235,0.2)]"
               >
                 Start New Chat
               </button>
            </div>
          )
        ) : (
          <LiveInterface />
        )}
      </main>
    </div>
  );
};

export default App;
