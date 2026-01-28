
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

function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
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
  const [needsKey, setNeedsKey] = useState(false);
  
  // Editing state
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');

  const scrollRef = useRef<HTMLDivElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    const checkKey = async () => {
      if (!(window as any).aistudio) return;
      const hasKey = await (window as any).aistudio.hasSelectedApiKey();
      if (!hasKey && !process.env.API_KEY) {
        setNeedsKey(true);
      }
    };
    checkKey();

    // Initialize Speech Recognition
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = true; // Changed to true for better flow
      recognition.interimResults = true;
      
      // Auto-detect browser language or default to Bangla/English
      const userLang = navigator.language || 'en-US';
      recognition.lang = userLang.startsWith('bn') ? 'bn-BD' : 'en-US'; 

      recognition.onstart = () => setIsListening(true);
      recognition.onend = () => setIsListening(false);
      recognition.onerror = (event: any) => {
        console.error("Speech Recognition Error:", event.error);
        setIsListening(false);
      };
      
      recognition.onresult = (event: any) => {
        let finalTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          }
        }
        
        if (finalTranscript) {
          setInput(prev => {
            const trimmedPrev = prev.trim();
            return trimmedPrev ? `${trimmedPrev} ${finalTranscript}` : finalTranscript;
          });
        }
      };
      recognitionRef.current = recognition;
    }

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
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
      if (!recognitionRef.current) {
        alert("Speech recognition is not supported in this browser.");
        return;
      }
      try {
        recognitionRef.current.start();
      } catch (e) {
        console.error("Recognition start failed:", e);
        recognitionRef.current.stop();
      }
    }
  };

  const handleOpenKeyDialog = async () => {
    if ((window as any).aistudio) {
      await (window as any).aistudio.openSelectKey();
      setNeedsKey(false);
    }
  };

  const handleSpeak = async (text: string, index: number) => {
    if (isSpeaking !== null) return;
    setIsSpeaking(index);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: text }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Fenrir' },
            },
          },
        },
      });
      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Audio) {
        if (!audioContextRef.current) {
          audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        }
        const ctx = audioContextRef.current;
        if (ctx.state === 'suspended') await ctx.resume();
        const audioBuffer = await decodeAudioData(decode(base64Audio), ctx, 24000, 1);
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);
        source.onended = () => setIsSpeaking(null);
        source.start(0);
      } else {
        setIsSpeaking(null);
      }
    } catch (error) {
      console.error('TTS Error:', error);
      setIsSpeaking(null);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const newAttachments: Attachment[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const base64 = await fileToBase64(file);
        newAttachments.push({
          data: base64,
          mimeType: file.type || 'application/octet-stream',
          name: file.name
        });
      } catch (err) {
        console.error("File read error:", err);
      }
    }
    setAttachments(prev => [...prev, ...newAttachments]);
  };

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const generatePDF = (content: string) => {
    const doc = new jsPDF();
    const splitText = doc.splitTextToSize(content, 180);
    doc.text(splitText, 10, 10);
    doc.save("WASO_Document.pdf");
  };

  const generatePPTX = (content: string) => {
    const pres = new pptxgen();
    const slide = pres.addSlide();
    slide.addText(content, { x: 1, y: 1, w: 8, h: 4, fontSize: 18, color: "363636" });
    pres.writeFile({ fileName: "WASO_Presentation.pptx" });
  };

  const performAIGeneration = async (currentInput: string, currentAttachments: Attachment[], historyBefore: Message[]) => {
    setIsLoading(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const promptLower = currentInput.toLowerCase();
      const isImageGen = promptLower.includes("generate image") || 
                         promptLower.includes("make a picture") || 
                         promptLower.includes("create image") ||
                         promptLower.includes("ছবি তৈরি করো");
      
      const isPdfGen = promptLower.includes("generate pdf") || promptLower.includes("pdf তৈরি করো");
      const isPptxGen = promptLower.includes("generate pptx") || promptLower.includes("presentation তৈরি করো");

      if (isImageGen) {
        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash-image',
          contents: [{ parts: [{ text: `Professional aesthetic masterpiece by Wasin: ${currentInput}. High resolution, 4k, cinematic lighting.` }] }],
          config: { imageConfig: { aspectRatio: "1:1" } }
        });
        
        let modelMessage: Message | null = null;
        for (const part of response.candidates?.[0]?.content?.parts || []) {
          if (part.inlineData) {
            modelMessage = {
              role: 'model',
              parts: [{ text: "Masterpiece generated successfully." }],
              timestamp: Date.now(),
              attachments: [{
                data: part.inlineData.data,
                mimeType: part.inlineData.mimeType,
                name: "waso_art.png"
              }],
              isImage: true
            };
            break;
          }
        }
        
        if (modelMessage) {
          onUpdateMessages([...historyBefore, modelMessage]);
        } else {
          onUpdateMessages([...historyBefore, { role: 'model', parts: [{ text: response.text || "Image generation failed." }], timestamp: Date.now() }]);
        }
      } else {
        const contentsParts: any[] = [{ text: currentInput }];
        currentAttachments.forEach(att => {
          contentsParts.push({ inlineData: { data: att.data, mimeType: att.mimeType } });
        });
        
        const response = await ai.models.generateContent({
          model: isPdfGen || isPptxGen ? 'gemini-3-pro-preview' : 'gemini-3-flash-preview',
          contents: [{ parts: contentsParts }],
          config: { systemInstruction: WARVI_SYSTEM_PROMPT }
        });
        
        const text = response.text || 'Connection timeout. Please retry.';
        const modelMessage: Message = { role: 'model', parts: [{ text }], timestamp: Date.now() };
        onUpdateMessages([...historyBefore, modelMessage]);
        
        if (isPdfGen) generatePDF(text);
        if (isPptxGen) generatePPTX(text);
      }
    } catch (error: any) {
      console.error('Chat Error:', error);
      if (error.message?.includes("entity was not found")) {
        setNeedsKey(true);
      }
      onUpdateMessages([...historyBefore, { 
        role: 'model', 
        parts: [{ text: "System Error: Uplink failed. Please verify your API Key." }], 
        timestamp: Date.now() 
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (needsKey) {
      handleOpenKeyDialog();
      return;
    }
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
    
    // Stop listening on submit
    if (isListening) {
      recognitionRef.current?.stop();
    }
    
    await performAIGeneration(currentInput, currentAttachments, updatedMessages);
  };

  const startEditing = (idx: number, text: string) => {
    setEditingIdx(idx);
    setEditValue(text);
  };

  const cancelEditing = () => {
    setEditingIdx(null);
    setEditValue('');
  };

  const handleEditSubmit = async (idx: number) => {
    if (!editValue.trim() || isLoading) return;

    const originalMessage = initialMessages[idx];
    const updatedUserMessage: Message = {
      ...originalMessage,
      parts: [{ text: editValue }],
      timestamp: Date.now()
    };

    const newHistory = [...initialMessages.slice(0, idx), updatedUserMessage];
    onUpdateMessages(newHistory);
    
    setEditingIdx(null);
    setEditValue('');
    
    await performAIGeneration(editValue, updatedUserMessage.attachments || [], newHistory);
  };

  return (
    <div className="flex flex-col h-full relative">
      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 md:p-8 lg:p-10 space-y-6 md:space-y-8 scroll-smooth pb-24 md:pb-28"
      >
        {initialMessages.map((msg, idx) => (
          <div 
            key={idx} 
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2 duration-300`}
          >
            <div className={`group relative max-w-[95%] md:max-w-[80%] lg:max-w-[70%] flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
              <div className={`p-3 md:p-5 shadow-xl transition-all duration-300 rounded-2xl md:rounded-3xl ${
                msg.role === 'user' 
                  ? 'bg-blue-600 text-white rounded-tr-none border border-blue-400/20' 
                  : 'glass-card text-blue-50 border border-blue-500/10 rounded-tl-none hover:bg-white/[0.04]'
              }`}>
                {editingIdx === idx ? (
                  <div className="space-y-3 min-w-[200px] md:min-w-[300px]">
                    <textarea
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      className="w-full bg-black/20 border border-white/20 rounded-xl p-3 text-white focus:outline-none focus:ring-1 focus:ring-white/50 resize-none min-h-[100px] text-sm"
                      autoFocus
                    />
                    <div className="flex justify-end gap-2">
                      <button 
                        onClick={cancelEditing}
                        className="px-3 py-1.5 rounded-lg bg-white/10 text-xs font-bold hover:bg-white/20 transition-all uppercase tracking-widest"
                      >
                        Cancel
                      </button>
                      <button 
                        onClick={() => handleEditSubmit(idx)}
                        className="px-3 py-1.5 rounded-lg bg-white text-blue-600 text-xs font-bold hover:bg-blue-50 transition-all uppercase tracking-widest"
                      >
                        Save & Send
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="text-[13px] md:text-base whitespace-pre-wrap leading-relaxed tracking-wide font-medium">
                    {msg.parts[0].text}
                  </div>
                )}

                {msg.attachments && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {msg.attachments.map((att, attIdx) => (
                      <div key={attIdx} className="relative group/att">
                        {att.mimeType.startsWith('image/') ? (
                          <div className="relative overflow-hidden rounded-xl border border-white/10 shadow-lg group-hover/att:border-blue-500/50 transition-all">
                            <img 
                              src={`data:${att.mimeType};base64,${att.data}`} 
                              alt={att.name} 
                              className="w-full max-w-[180px] md:max-w-sm h-auto md:max-h-[500px] object-contain block"
                            />
                            <a 
                              href={`data:${att.mimeType};base64,${att.data}`} 
                              download={att.name}
                              className="absolute top-1 right-1 p-1.5 bg-black/60 rounded-lg text-white opacity-0 group-hover/att:opacity-100 transition-opacity"
                            >
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                            </a>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 p-3 bg-white/5 rounded-xl text-[10px] md:text-xs font-bold border border-white/10 hover:bg-white/10 transition-colors">
                             <svg className="w-4 h-4 text-blue-400" fill="currentColor" viewBox="0 0 20 20"><path d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" /></svg>
                             <span className="truncate max-w-[80px] md:max-w-[140px] text-white/70">{att.name}</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <div className="text-[7px] md:text-[8px] mt-2 opacity-30 uppercase tracking-[0.2em] font-black font-mono flex justify-between items-center w-full min-w-[80px]">
                  <span>{msg.role === 'user' ? 'USER' : 'WASO'}</span>
                  <span>{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
              </div>
              
              <div className="mt-1.5 flex gap-1.5 ml-1">
                {msg.role === 'model' && (
                  <button 
                    onClick={() => handleSpeak(msg.parts[0].text, idx)}
                    disabled={isSpeaking !== null}
                    className={`p-1.5 rounded-full glass-card border border-white/10 text-gray-400 transition-all hover:bg-white/10 hover:text-white ${isSpeaking === idx ? 'text-blue-400 border-blue-500/20' : ''}`}
                    title="Play Voice"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className={`w-3.5 h-3.5 md:w-4 md:h-4 ${isSpeaking === idx ? 'animate-pulse' : ''}`} viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414zm-2.829 2.828a1 1 0 011.415 0A5.983 5.983 0 0115 10a5.984 5.984 0 01-1.757 4.243 1 1 0 01-1.415-1.415A3.984 3.984 0 0013 10a3.983 3.983 0 00-1.172-2.828 1 1 0 010-1.415z" clipRule="evenodd" />
                    </svg>
                  </button>
                )}
                {msg.role === 'user' && !isLoading && editingIdx === null && (
                  <button 
                    onClick={() => startEditing(idx, msg.parts[0].text)}
                    className="p-1.5 rounded-full glass-card border border-white/10 text-gray-500 hover:text-blue-400 transition-all hover:bg-white/10"
                    title="Edit Message"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 md:w-4 md:h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="glass-card rounded-xl p-2.5 md:p-3 px-4 md:px-5 flex items-center gap-2 border border-blue-500/10 shadow-xl">
              <span className="text-[8px] md:text-[9px] font-black text-blue-400 tracking-[0.2em] uppercase animate-pulse">Thinking</span>
              <div className="flex gap-1">
                <div className="w-1 h-1 bg-blue-500 rounded-full animate-bounce [animation-duration:0.6s]"></div>
                <div className="w-1 h-1 bg-blue-500 rounded-full animate-bounce [animation-duration:0.6s] [animation-delay:0.15s]"></div>
                <div className="w-1 h-1 bg-blue-500 rounded-full animate-bounce [animation-duration:0.6s] [animation-delay:0.3s]"></div>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="absolute bottom-0 left-0 right-0 p-2 md:p-3 border-t border-white/5 glass-card bg-black/95 backdrop-blur-2xl shrink-0 z-20">
        <div className="max-w-4xl mx-auto flex flex-col gap-1.5">
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-1 pb-1">
              {attachments.map((att, i) => (
                <div key={i} className="relative bg-white/5 rounded-md p-1 border border-white/10 flex items-center gap-1.5 animate-in fade-in slide-in-from-bottom-2">
                  <div className="w-5 h-5 flex items-center justify-center bg-blue-500/10 rounded border border-blue-500/20">
                    {att.mimeType.startsWith('image/') ? (
                         <svg className="w-3 h-3 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                    ) : (
                         <svg className="w-3 h-3 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                    )}
                  </div>
                  <span className="text-[7px] text-white font-bold max-w-[60px] truncate leading-none">{att.name}</span>
                  <button 
                    onClick={() => removeAttachment(i)}
                    className="p-0.5 hover:bg-white/10 rounded text-gray-500 hover:text-red-400 transition-all"
                  >
                    <svg className="w-2 h-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
              ))}
            </div>
          )}
          
          <form onSubmit={handleSubmit} className="flex gap-1.5 md:gap-2 items-center h-9 md:h-11">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-9 md:w-11 h-full rounded-lg md:rounded-xl bg-white/5 border border-white/10 text-blue-400 hover:bg-white/10 hover:border-blue-500/30 transition-all active:scale-95 shrink-0 flex items-center justify-center group"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 md:w-5 md:h-5 group-hover:scale-110 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
              </svg>
            </button>
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleFileChange} 
              multiple 
              className="hidden" 
              accept="image/*,application/pdf"
            />
            
            <div className="flex-1 h-full relative group">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={needsKey ? "Click to Select API Key..." : "Type message..."}
                onClick={() => needsKey && handleOpenKeyDialog()}
                readOnly={needsKey}
                className="w-full h-full bg-white/5 border border-white/10 rounded-lg md:rounded-xl px-3 md:px-4 pr-10 focus:outline-none focus:ring-1 focus:ring-blue-500/40 transition-all placeholder:text-gray-600 text-[12px] md:text-[14px] font-medium text-white"
              />
              <button
                type="button"
                onClick={toggleListening}
                className={`absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg transition-all ${isListening ? 'text-red-500 bg-red-500/10 animate-pulse' : 'text-gray-500 hover:text-blue-400'}`}
                title="Voice Input"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 md:w-5 md:h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
              </button>
            </div>
            
            <button
              type="submit"
              disabled={!needsKey && isLoading || (!needsKey && !input.trim() && attachments.length === 0)}
              className="bg-blue-600 hover:bg-blue-500 disabled:bg-gray-800/50 disabled:text-gray-600 disabled:opacity-50 text-white w-9 h-9 md:w-11 md:h-11 rounded-lg md:rounded-xl flex items-center justify-center transition-all shadow-lg active:scale-95 shrink-0 border border-blue-400/20"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 md:w-5 md:h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 10l7-7m0 0l7 7m-7-7v18" />
              </svg>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
