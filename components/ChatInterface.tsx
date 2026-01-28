
import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, Modality } from '@google/genai';
import { jsPDF } from "jspdf";
import pptxgen from "pptxgenjs";
import { WARVI_SYSTEM_PROMPT } from '../constants';
import { Message, Attachment } from '../types';

interface ChatInterfaceProps {
  sessionId: string;
  initialMessages: Message[];
  onUpdateMessages: (messages: Message[]) => void;
}

const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const base64String = (reader.result as string).split(',')[1];
      resolve(base64String);
    };
    reader.onerror = (error) => reject(error);
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
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = navigator.language.includes('bn') ? 'bn-BD' : 'en-US';

      recognition.onstart = () => setIsListening(true);
      recognition.onend = () => setIsListening(false);
      recognition.onerror = () => setIsListening(false);
      
      recognition.onresult = (event: any) => {
        let currentTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          currentTranscript += event.results[i][0].transcript;
        }
        if (currentTranscript) {
          setInput(currentTranscript);
        }
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
      setInput(''); // Clear for new voice input session
      recognitionRef.current?.start();
    }
  };

  const performAIGeneration = async (currentInput: string, currentAttachments: Attachment[], historyBefore: Message[]) => {
    setIsLoading(true);
    try {
      const promptLower = currentInput.toLowerCase();
      const isImageGen = promptLower.includes("generate image") || 
                         promptLower.includes("create image") ||
                         promptLower.includes("ছবি তৈরি করো");
      
      const contentsParts: any[] = [{ text: currentInput }];
      currentAttachments.forEach(att => {
        contentsParts.push({ inlineData: { data: att.data, mimeType: att.mimeType } });
      });

      const response = await fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: contentsParts }],
          systemInstruction: WARVI_SYSTEM_PROMPT,
          isImage: isImageGen
        })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Uplink failure');

      if (isImageGen) {
        let modelMessage: Message | null = null;
        for (const part of data.parts || []) {
          if (part.inlineData) {
            modelMessage = {
              role: 'model',
              parts: [{ text: "Masterpiece generated." }],
              timestamp: Date.now(),
              attachments: [{ data: part.inlineData.data, mimeType: part.inlineData.mimeType, name: "waso_art.png" }],
              isImage: true
            };
            break;
          }
        }
        onUpdateMessages([...historyBefore, modelMessage || { role: 'model', parts: [{ text: "Image generation failed." }], timestamp: Date.now() }]);
      } else {
        const text = data.text || 'No response from WASO.';
        onUpdateMessages([...historyBefore, { role: 'model', parts: [{ text }], timestamp: Date.now() }]);
        if (promptLower.includes("generate pdf")) generatePDF(text);
        if (promptLower.includes("generate pptx")) generatePPTX(text);
      }
    } catch (error: any) {
      console.error('API Error:', error);
      onUpdateMessages([...historyBefore, { role: 'model', parts: [{ text: "System Offline: Backend unreachable." }], timestamp: Date.now() }]);
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

  const handleEditSubmit = async (idx: number) => {
    if (!editValue.trim() || isLoading) return;
    const originalMessage = initialMessages[idx];
    const updatedUserMessage: Message = { ...originalMessage, parts: [{ text: editValue }], timestamp: Date.now() };
    const newHistory = [...initialMessages.slice(0, idx), updatedUserMessage];
    onUpdateMessages(newHistory);
    setEditingIdx(null);
    await performAIGeneration(editValue, updatedUserMessage.attachments || [], newHistory);
  };

  const generatePDF = (content: string) => {
    const doc = new jsPDF();
    doc.text(doc.splitTextToSize(content, 180), 10, 10);
    doc.save("WASO_Doc.pdf");
  };

  const generatePPTX = (content: string) => {
    const pres = new pptxgen();
    pres.addSlide().addText(content, { x: 1, y: 1, w: 8, h: 4, fontSize: 14 });
    pres.writeFile({ fileName: "WASO_Pres.pptx" });
  };

  return (
    <div className="flex flex-col h-full relative">
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6 scroll-smooth pb-28">
        {initialMessages.map((msg, idx) => (
          <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2`}>
            <div className={`max-w-[90%] md:max-w-[75%] flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
              <div className={`p-4 shadow-xl rounded-2xl ${msg.role === 'user' ? 'bg-blue-600 text-white rounded-tr-none' : 'glass-card text-blue-50 border border-blue-500/10 rounded-tl-none'}`}>
                {editingIdx === idx ? (
                  <div className="space-y-3 min-w-[250px]">
                    <textarea value={editValue} onChange={(e) => setEditValue(e.target.value)} className="w-full bg-black/20 border border-white/20 rounded-xl p-3 text-sm focus:ring-1 focus:ring-white/50" autoFocus />
                    <div className="flex justify-end gap-2">
                      <button onClick={() => setEditingIdx(null)} className="px-3 py-1 bg-white/10 rounded-lg text-xs font-bold uppercase">Cancel</button>
                      <button onClick={() => handleEditSubmit(idx)} className="px-3 py-1 bg-white text-blue-600 rounded-lg text-xs font-bold uppercase">Save</button>
                    </div>
                  </div>
                ) : (
                  <div className="text-sm md:text-base whitespace-pre-wrap">{msg.parts[0].text}</div>
                )}
                {msg.attachments?.map((att, i) => (
                  <div key={i} className="mt-2">
                    {att.mimeType.startsWith('image/') ? <img src={`data:${att.mimeType};base64,${att.data}`} className="max-w-full rounded-lg" /> : <div className="p-2 bg-white/5 rounded text-xs truncate">{att.name}</div>}
                  </div>
                ))}
              </div>
              {msg.role === 'user' && !isLoading && editingIdx === null && (
                <button onClick={() => { setEditingIdx(idx); setEditValue(msg.parts[0].text); }} className="mt-1 p-1.5 opacity-40 hover:opacity-100 transition-opacity">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                </button>
              )}
            </div>
          </div>
        ))}
        {isLoading && <div className="flex justify-start"><div className="glass-card rounded-xl p-3 px-5 text-xs font-black text-blue-400 uppercase animate-pulse">WASO Thinking...</div></div>}
      </div>

      <div className="absolute bottom-0 left-0 right-0 p-3 glass-card bg-black/95 backdrop-blur-2xl z-20">
        <form onSubmit={handleSubmit} className="max-w-4xl mx-auto flex gap-2 items-center h-11">
          <button type="button" onClick={() => fileInputRef.current?.click()} className="w-11 h-full rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-blue-400 hover:bg-white/10">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
          </button>
          <input type="file" ref={fileInputRef} onChange={async (e) => {
            const files = e.target.files; if (!files) return;
            const res = []; for (let i = 0; i < files.length; i++) {
              res.push({ data: await fileToBase64(files[i]), mimeType: files[i].type, name: files[i].name });
            }
            setAttachments(prev => [...prev, ...res]);
          }} multiple className="hidden" />
          
          <div className="flex-1 relative h-full">
            <input type="text" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Type or speak message..." className="w-full h-full bg-white/5 border border-white/10 rounded-xl px-4 pr-10 focus:outline-none focus:ring-1 focus:ring-blue-500/40 text-sm" />
            <button type="button" onClick={toggleListening} className={`absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg transition-all ${isListening ? 'text-red-500 bg-red-500/10 animate-pulse' : 'text-gray-500 hover:text-blue-400'}`}>
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
            </button>
          </div>
          
          <button type="submit" disabled={isLoading || (!input.trim() && attachments.length === 0)} className="bg-blue-600 hover:bg-blue-500 text-white w-11 h-11 rounded-xl flex items-center justify-center transition-all disabled:opacity-50">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 10l7-7m0 0l7 7m-7-7v18" /></svg>
          </button>
        </form>
      </div>
    </div>
  );
};
