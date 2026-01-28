
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, Modality } from '@google/genai';
import { WARVI_SYSTEM_PROMPT } from '../constants';

// Manual Base64 encoding as required by instructions
function encode(bytes: Uint8Array) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Manual Base64 decoding as required by instructions
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

export const LiveInterface: React.FC = () => {
  const [isActive, setIsActive] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [needsKey, setNeedsKey] = useState(false);
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const sessionRef = useRef<any>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  // Check if API key is available or needs selection (for sharable apps)
  useEffect(() => {
    const checkKey = async () => {
      if (!(window as any).aistudio) return;
      const hasKey = await (window as any).aistudio.hasSelectedApiKey();
      if (!hasKey && !process.env.API_KEY) {
        setNeedsKey(true);
      }
    };
    checkKey();
  }, []);

  const handleOpenKeyDialog = async () => {
    if ((window as any).aistudio) {
      await (window as any).aistudio.openSelectKey();
      setNeedsKey(false);
      // Proceeding after selection
      startSession();
    }
  };

  const stopSession = useCallback(() => {
    if (sessionRef.current) {
      sessionRef.current.close?.();
      sessionRef.current = null;
    }
    setIsActive(false);
    setIsConnecting(false);
    
    for (const source of sourcesRef.current) {
        try { source.stop(); } catch(e) {}
    }
    sourcesRef.current.clear();
    nextStartTimeRef.current = 0;

    if (audioContextRef.current) audioContextRef.current.close().catch(() => {});
    if (outputAudioContextRef.current) outputAudioContextRef.current.close().catch(() => {});
  }, []);

  const startSession = async () => {
    try {
      setErrorMsg(null);
      setIsConnecting(true);
      
      // 1. Check for API key (AI Studio specific sharing logic)
      if ((window as any).aistudio) {
        const hasKey = await (window as any).aistudio.hasSelectedApiKey();
        if (!hasKey && !process.env.API_KEY) {
          setNeedsKey(true);
          setIsConnecting(false);
          return;
        }
      }

      // 2. Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(err => {
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          throw new Error("Microphone access denied. Please enable permissions in your browser and reload.");
        }
        throw new Error("Unable to access microphone. Please check your hardware.");
      });
      
      // 3. Initialize GenAI (Always new instance to catch latest key)
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      
      if (inputCtx.state === 'suspended') await inputCtx.resume();
      if (outputCtx.state === 'suspended') await outputCtx.resume();
      
      audioContextRef.current = inputCtx;
      outputAudioContextRef.current = outputCtx;

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { 
              prebuiltVoiceConfig: { 
                voiceName: 'Fenrir' 
              } 
            },
          },
          systemInstruction: WARVI_SYSTEM_PROMPT + " Respond only as WASO in a professional Baritone voice.",
        },
        callbacks: {
          onopen: () => {
            setIsActive(true);
            setIsConnecting(false);
            const source = inputCtx.createMediaStreamSource(stream);
            const scriptProcessor = inputCtx.createScriptProcessor(4096, 1, 1);
            
            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const l = inputData.length;
              const int16 = new Int16Array(l);
              for (let i = 0; i < l; i++) {
                int16[i] = inputData[i] * 32768;
              }
              const pcmBlob = {
                data: encode(new Uint8Array(int16.buffer)),
                mimeType: 'audio/pcm;rate=16000',
              };
              
              sessionPromise.then((session) => {
                session.sendRealtimeInput({ media: pcmBlob });
              });
            };
            
            source.connect(scriptProcessor);
            scriptProcessor.connect(inputCtx.destination);
          },
          onmessage: async (message) => {
            const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (base64Audio && outputAudioContextRef.current) {
              const ctx = outputAudioContextRef.current;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
              
              const audioBuffer = await decodeAudioData(
                decode(base64Audio),
                ctx,
                24000,
                1
              );
              
              const source = ctx.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(ctx.destination);
              source.addEventListener('ended', () => {
                sourcesRef.current.delete(source);
              });
              
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += audioBuffer.duration;
              sourcesRef.current.add(source);
            }

            if (message.serverContent?.interrupted) {
              for (const source of sourcesRef.current) {
                try { source.stop(); } catch(e) {}
              }
              sourcesRef.current.clear();
              nextStartTimeRef.current = 0;
            }
          },
          onerror: (err: any) => {
            console.error('Live Error:', err);
            if (err.message?.includes("entity was not found")) {
              setErrorMsg("API Key issue. Please re-select your key.");
              setNeedsKey(true);
            } else {
              setErrorMsg("Connection interrupted. Please try again.");
            }
            stopSession();
          },
          onclose: () => {
            stopSession();
          }
        }
      });

      sessionRef.current = await sessionPromise;
    } catch (error: any) {
      console.error('Failed to start Live API:', error);
      setErrorMsg(error.message || "Failed to initiate voice link.");
      setIsConnecting(false);
    }
  };

  useEffect(() => {
    return () => stopSession();
  }, [stopSession]);

  return (
    <div className="flex flex-col h-full items-center justify-center p-4 md:p-8 overflow-hidden relative">
      <div className="flex flex-col items-center gap-6 md:gap-12 w-full max-w-3xl text-center py-4 md:py-8 h-full md:h-auto justify-center">
        
        <div className="relative group shrink-0">
          <div className={`w-40 h-40 xs:w-52 xs:h-52 md:w-80 md:h-80 lg:w-96 lg:h-96 flex items-center justify-center transition-all duration-700 ease-in-out ${isActive ? 'scale-110 drop-shadow-[0_0_40px_rgba(59,130,246,0.6)]' : 'opacity-80 drop-shadow-[0_0_20px_rgba(59,130,246,0.2)]'}`}>
             <img 
               src="https://i.ibb.co.com/TBzBrKdg/Av-removebg-preview.png" 
               alt="WASO AI Core" 
               className="w-full h-full object-contain filter-none"
             />
          </div>
          
          {isActive && (
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-full bg-blue-500/15 rounded-full blur-[90px] animate-pulse pointer-events-none"></div>
          )}
        </div>

        <div className="space-y-3 md:space-y-4 shrink-0 px-4">
          <div className="flex flex-col items-center gap-1 md:gap-2">
            <h2 className="text-2xl md:text-5xl font-black tracking-tight text-white uppercase">
              {isActive ? 'WASO ACTIVE' : isConnecting ? 'CONNECTING...' : 'SYSTEM STANDBY'}
            </h2>
            <div className="flex items-center gap-2 md:gap-3">
               <div className="h-px w-6 md:w-12 bg-blue-500/30"></div>
               <span className="text-[7px] md:text-[10px] text-blue-400 font-black tracking-[0.2em] md:tracking-[0.5em] uppercase">Baritone Link Established</span>
               <div className="h-px w-6 md:w-12 bg-blue-500/30"></div>
            </div>
            {errorMsg && (
              <p className="text-red-400 text-[10px] md:text-xs font-bold mt-2 uppercase tracking-widest bg-red-500/10 px-4 py-2 rounded-lg border border-red-500/20 animate-bounce max-w-sm">
                {errorMsg}
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-col items-center gap-4 md:gap-8 w-full max-w-xs md:max-w-none px-6 mt-4">
          {needsKey ? (
            <div className="flex flex-col items-center gap-4">
              <p className="text-gray-400 text-xs font-bold uppercase tracking-widest">Select an API Key to start</p>
              <button
                onClick={handleOpenKeyDialog}
                className="w-full md:w-auto bg-blue-600 hover:bg-blue-500 text-white px-8 md:px-14 py-4 md:py-6 rounded-xl md:rounded-3xl font-black text-sm md:text-xl tracking-widest transition-all shadow-lg active:scale-95 border border-blue-400/20"
              >
                SELECT API KEY
              </button>
              <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" className="text-blue-500 text-[10px] font-bold underline">Billing Docs</a>
            </div>
          ) : !isActive ? (
            <button
              onClick={startSession}
              disabled={isConnecting}
              className="w-full md:w-auto bg-blue-600 hover:bg-blue-500 disabled:bg-gray-800 text-white px-8 md:px-14 py-4 md:py-6 rounded-xl md:rounded-3xl font-black text-sm md:text-xl tracking-widest flex items-center justify-center gap-3 md:gap-4 transition-all shadow-[0_10px_30px_rgba(37,99,235,0.2)] active:scale-95 border border-blue-400/20"
            >
              {isConnecting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  INITIATING...
                </>
              ) : (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 md:w-7 md:h-7" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm1 14.5h-2v-2h2v2zm0-4h-2V7h2v5.5z" />
                  </svg>
                  START CONVERSATION
                </>
              )}
            </button>
          ) : (
            <button
              onClick={stopSession}
              className="w-full md:w-auto bg-red-500/10 border-2 border-red-500/40 hover:bg-red-500 hover:text-white text-red-500 px-8 md:px-14 py-4 md:py-6 rounded-xl md:rounded-3xl font-black text-sm md:text-xl tracking-widest flex items-center justify-center gap-3 md:gap-4 transition-all shadow-xl"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 md:w-7 md:h-7" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12 17 15.59z" />
              </svg>
              DISCONNECT
            </button>
          )}

          <div className="flex items-center gap-2 opacity-60">
             <div className="flex gap-0.5 md:gap-1">
               {[...Array(5)].map((_, i) => (
                 <div key={i} className={`w-0.5 md:w-1 h-3 md:h-4 rounded-full bg-blue-500 ${isActive ? 'animate-bounce' : ''}`} style={{ animationDelay: `${i * 0.1}s` }}></div>
               ))}
             </div>
             <p className="text-[7px] md:text-[10px] text-gray-400 font-bold uppercase tracking-widest font-mono">
                WASO 2.5 CORE | BARITONE VOX
             </p>
          </div>
        </div>
      </div>
    </div>
  );
};
