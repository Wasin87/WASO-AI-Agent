
import React, { useState, useRef, useEffect } from 'react';
import { jsPDF } from "jspdf";
import pptxgen from "pptxgenjs";
import { WARVI_SYSTEM_PROMPT } from '../constants';
import { Message, Attachment } from '../types';

interface ChatInterfaceProps {
  sessionId: string;
  initialMessages: Message[];
  onUpdateMessages: (messages: Message[]) => void;
}

// Helper: Decode Base64 for Audio
function decodeBase64(base64: string) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

// Helper: Decode Raw PCM to AudioBuffer
async function decodeAudioData(data: Uint8Array, ctx: AudioContext): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const buffer = ctx.createBuffer(1, dataInt16.length, 24000);
  const channelData = buffer.getChannelData(0);
  for (let i = 0; i < dataInt16.length; i++) {
    channelData[i] = dataInt16[i] / 32768.0;
  }
  return buffer;
}

const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
  });
};

export const ChatInterface: React.FC<ChatInterfaceProps> = ({ sessionId, initialMessages, onUpdateMessages }) => {
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState<number | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');

  const scrollRef = useRef<HTMLDivElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    // Speech Recognition Setup
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = navigator.language.includes('bn') ? 'bn-BD' : 'en-US';

      recognition.onstart = () => setIsListening(true);
      recognition.onend = () => setIsListening(false);
      recognition.onresult = (event: any) => {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          transcript += event.results[i][0].transcript;
        }
        if (transcript) setInput(transcript);
      };
      recognitionRef.current = recognition;
    }
    return () => recognitionRef.current?.stop();
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [initialMessages, isLoading, attachments, editingIdx]);

  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
    } else {
      setInput('');
      recognitionRef.current?.start();
    }
  };

  const handleSpeak = async (text: string, index: number) => {
    if (isSpeaking !== null) return;
    setIsSpeaking(index);
    try {
      const response = await fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'tts', text })
      });
      const data = await response.json();
      if (data.audio) {
        if (!audioContextRef.current) audioContextRef.current = new AudioContext({ sampleRate: 24000 });
        const ctx = audioContextRef.current;
        const buffer = await decodeAudioData(decodeBase64(data.audio), ctx);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.onended = () => setIsSpeaking(null);
        source.start(0);
      }
    } catch (e) {
      console.error(e);
      setIsSpeaking(null);
    }
  };

  const performAIGeneration = async (currentInput: string, currentAttachments: Attachment[], historyBefore: Message[]) => {
    setIsLoading(true);
    try {
      const contentsParts: any[] = [{ text: currentInput }];
      currentAttachments.forEach(att => {
        contentsParts.push({ inlineData: { data: att.data, mimeType: att.mimeType } });
      });

      const response = await fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: contentsParts }],
          systemInstruction: WARVI_SYSTEM_PROMPT
        })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Uplink failure');

      if (data.type === 'image') {
        let modelMessage: Message | null = null;
        for (const part of data.parts || []) {
          if (part.inlineData) {
            modelMessage = {
              role: 'model',
              parts: [{ text: "Masterpiece generated by WASO." }],
              timestamp: Date.now(),
              attachments: [{ data: part.inlineData.data, mimeType: part.inlineData.mimeType, name: "waso_art.png" }],
              isImage: true
            };
            break;
          }
        }
        onUpdateMessages([...historyBefore, modelMessage || { role: 'model', parts: [{ text: "Generation failed." }], timestamp: Date.now() }]);
      } else {
        const text = data.text || 'No response from WASO.';
        onUpdateMessages([...historyBefore, { role: 'model', parts: [{ text }], timestamp: Date.now() }]);
      }
    } catch (error: any) {
      onUpdateMessages([...historyBefore, { role: 'model', parts: [{ text: "WASO is currently offline. Check Vercel API logs." }], timestamp: Date.now() }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if ((!input.trim() && attachments.length === 0) || isLoading) return;

    const userMessage: Message = { 
      role: 'user', 
      parts: [{ text: input }], 
      timestamp: Date.now(),
      attachments: attachments.length > 0 ? [...attachments] : undefined
    };
    const updatedMessages = [...initialMessages, userMessage];
    onUpdateMessages(updatedMessages);
    
    const currentInput = input;
    const currentAttachments = [...attachments];
    setInput('');
    setAttachments([]);
    if (isListening) recognitionRef.current?.stop();
    
    await performAIGeneration(currentInput, currentAttachments, updatedMessages);
  };

  return (
    <div className="flex flex-col h-full relative">
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 md:p-10 space-y-8 scroll-smooth pb-32">
        {initialMessages.map((msg, idx) => (
          <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-4`}>
            <div className={`max-w-[90%] md:max-w-[70%] flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
              <div className={`p-4 md:p-6 shadow-2xl rounded-3xl ${msg.role === 'user' ? 'bg-blue-600 text-white rounded-tr-none' : 'glass-card text-blue-50 border border-white/10 rounded-tl-none'}`}>
                {editingIdx === idx ? (
                  <div className="space-y-3 min-w-[280px]">
                    <textarea value={editValue} onChange={(e) => setEditValue(e.target.value)} className="w-full bg-black/40 border border-white/20 rounded-2xl p-4 text-sm focus:ring-1 focus:ring-blue-500/50" autoFocus />
                    <div className="flex justify-end gap-3">
                      <button onClick={() => setEditingIdx(null)} className="px-4 py-2 bg-white/5 rounded-xl text-xs font-bold uppercase tracking-widest">Cancel</button>
                      <button onClick={() => {
                        const newHist = [...initialMessages.slice(0, idx), { ...msg, parts: [{ text: editValue }] }];
                        onUpdateMessages(newHist);
                        setEditingIdx(null);
                        performAIGeneration(editValue, msg.attachments || [], newHist);
                      }} className="px-4 py-2 bg-white text-blue-600 rounded-xl text-xs font-bold uppercase tracking-widest">Save</button>
                    </div>
                  </div>
                ) : (
                  <div className="text-sm md:text-base whitespace-pre-wrap leading-relaxed">{msg.parts[0].text}</div>
                )}
                {msg.attachments?.map((att, i) => (
                  <div key={i} className="mt-4">
                    {att.mimeType.startsWith('image/') ? <img src={`data:${att.mimeType};base64,${att.data}`} className="max-w-full rounded-2xl border border-white/10" /> : <div className="p-3 bg-white/5 rounded-xl text-xs font-mono truncate">{att.name}</div>}
                  </div>
                ))}
              </div>
              <div className="mt-2 flex gap-3 px-1">
                {msg.role === 'model' && (
                  <button onClick={() => handleSpeak(msg.parts[0].text, idx)} className={`p-2 rounded-full glass-card hover:text-blue-400 transition-all ${isSpeaking === idx ? 'text-blue-500 animate-pulse' : 'text-gray-500'}`}>
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217z" /></svg>
                  </button>
                )}
                {msg.role === 'user' && !isLoading && (
                  <button onClick={() => { setEditingIdx(idx); setEditValue(msg.parts[0].text); }} className="p-2 rounded-full glass-card text-gray-500 hover:text-blue-400">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
        {isLoading && <div className="flex justify-start"><div className="glass-card rounded-2xl p-4 px-6 text-xs font-black text-blue-400 uppercase tracking-widest animate-pulse">WASO Thinking...</div></div>}
      </div>

      <div className="absolute bottom-0 left-0 right-0 p-4 glass-card bg-black/95 border-t border-white/5 z-20">
        <form onSubmit={handleSubmit} className="max-w-5xl mx-auto flex gap-3 items-center h-12 md:h-14">
          <button type="button" onClick={() => fileInputRef.current?.click()} className="w-12 h-full rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-blue-400 hover:bg-white/10 transition-all">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
          </button>
          <input type="file" ref={fileInputRef} onChange={async (e) => {
            const files = e.target.files; if (!files) return;
            const res = []; for (let i = 0; i < files.length; i++) {
              res.push({ data: await fileToBase64(files[i]), mimeType: files[i].type, name: files[i].name });
            }
            setAttachments(prev => [...prev, ...res]);
          }} multiple className="hidden" />
          
          <div className="flex-1 relative h-full">
            <input type="text" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Type or speak (Bangla/English)..." className="w-full h-full bg-white/5 border border-white/10 rounded-2xl px-5 pr-12 focus:outline-none focus:ring-1 focus:ring-blue-500/40 text-sm md:text-base font-medium" />
            <button type="button" onClick={toggleListening} className={`absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-xl transition-all ${isListening ? 'text-red-500 bg-red-500/10 animate-pulse' : 'text-gray-500 hover:text-blue-400'}`}>
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
            </button>
          </div>
          
          <button type="submit" disabled={isLoading || (!input.trim() && attachments.length === 0)} className="bg-blue-600 hover:bg-blue-500 text-white w-12 h-12 md:w-14 md:h-14 rounded-2xl flex items-center justify-center transition-all disabled:opacity-30 shadow-lg shadow-blue-500/20">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 10l7-7m0 0l7 7m-7-7v18" /></svg>
          </button>
        </form>
      </div>
    </div>
  );
};
